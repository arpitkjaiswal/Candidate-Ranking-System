import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Activity as ActivityIcon,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  GitCompareArrows,
  Pencil,
  Code2,
  FileText,
  Fingerprint,
  FlaskConical,
  LayoutDashboard,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MapPin,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  UploadCloud,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import { api, ApiError, request, json } from "./api";
import {
  STAGES,
  type Activity,
  type Candidate,
  type LabResult,
  type Question,
  type Report,
  type Role,
  type Stage,
} from "./types";

type View = "overview" | "pipeline" | "roles" | "lab" | "model";
const titles: Record<View, string> = {
  overview: "Candidate overview",
  pipeline: "Hiring pipeline",
  roles: "Open roles",
  lab: "Resume Lab",
  model: "Intelligence & transparency",
};
const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

function Score({ value, large = false }: { value: number; large?: boolean }) {
  return (
    <div
      className={`score ${large ? "large" : ""} ${value >= 75 ? "strong" : value >= 55 ? "good" : "low"}`}
      style={{ "--score": `${value}%` } as React.CSSProperties}
      role="img"
      aria-label={`${value} out of 100 alignment`}
    >
      <span>
        {Math.round(value)}
        {large && <small>/ 100</small>}
      </span>
    </div>
  );
}
function Badge({ stage }: { stage: Stage }) {
  return (
    <span className={`badge stage-${stage.toLowerCase()}`}>
      <i />
      {stage}
    </span>
  );
}
function Chips({ items, kind = "" }: { items: string[]; kind?: string }) {
  return (
    <div className="chips">
      {items.length ? (
        items.map((item) => (
          <span className={`chip ${kind}`} key={item}>
            {kind === "matched" && <Check size={12} />} {item}
          </span>
        ))
      ) : (
        <span className="muted small">None identified</span>
      )}
    </div>
  );
}
function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

function Modal({
  title,
  subtitle,
  children,
  close,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? "wide" : ""}`}
      >
        <div className="modal-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={close}
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Breakdown({ report }: { report: Report }) {
  return (
    <>
      <div className="breakdown">
        <div>
          <span>
            Required skills <small>65% weight</small>
          </span>
          <b>{report.skill_match_pct}%</b>
          <div className="bar">
            <i style={{ width: `${report.skill_match_pct}%` }} />
          </div>
        </div>
        <div>
          <span>
            Text relevance <small>35% weight</small>
          </span>
          <b>{report.text_similarity_pct}%</b>
          <div className="bar blue">
            <i style={{ width: `${report.text_similarity_pct}%` }} />
          </div>
        </div>
      </div>
      {report.warnings.map((warning) => (
        <p key={warning} className="notice">
          <CircleHelp size={15} />
          {warning}
        </p>
      ))}
    </>
  );
}

function NewRole({
  close,
  created,
  catalog,
  role,
  deleted,
}: {
  close: () => void;
  created: (role: Role) => void;
  catalog: string[];
  role?: Role;
  deleted?: () => void;
}) {
  const [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string[]>(role?.required_skills || []),
    [search, setSearch] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [deleteText, setDeleteText] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const savedRole = await api<Role>(role ? `/jobs/${role.id}` : "/jobs", {
        method: role ? "PUT" : "POST",
        ...json({
          ...Object.fromEntries(form),
          required_skills: selected,
          ...(role ? { version: role.version } : {}),
        }),
      });
      created(savedRole);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      title={role ? "Refine what matters." : "Make room for great talent."}
      subtitle={
        role
          ? "Saving requirements recalculates every candidate’s alignment."
          : "Define the role. Make the evidence count."
      }
      close={() => {
        if (!saving) close();
      }}
      wide
    >
      <form onSubmit={submit} className="form">
        <label>
          Role title
          <input
            name="title"
            defaultValue={role?.title}
            required
            minLength={3}
            maxLength={120}
            placeholder="e.g. Senior Backend Engineer"
          />
        </label>
        <div className="form-row">
          <label>
            Team
            <input
              name="department"
              defaultValue={role?.department || "Engineering"}
              required
              minLength={2}
              maxLength={80}
            />
          </label>
          <label>
            Location
            <input
              name="location"
              defaultValue={role?.location || "Remote"}
              required
              minLength={2}
              maxLength={100}
            />
          </label>
        </div>
        <label>
          Job description
          <textarea
            name="description"
            defaultValue={role?.description}
            required
            minLength={30}
            maxLength={20000}
            rows={5}
            placeholder="Describe the work, responsibilities, and skills that matter..."
          />
        </label>
        <div>
          <label htmlFor="skill-search">
            Required skills <span className="muted">· select up to 30</span>
          </label>
          <input
            id="skill-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find a skill..."
          />
          <div className="skill-picker">
            {catalog
              .filter((skill) =>
                skill.toLowerCase().includes(search.toLowerCase()),
              )
              .slice(0, 24)
              .map((skill) => (
                <button
                  type="button"
                  key={skill}
                  className={`chip ${selected.includes(skill) ? "selected" : ""}`}
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(skill)
                        ? current.filter((value) => value !== skill)
                        : current.length < 30
                          ? [...current, skill]
                          : current,
                    )
                  }
                >
                  {selected.includes(skill) ? (
                    <Check size={12} />
                  ) : (
                    <Plus size={12} />
                  )}{" "}
                  {skill}
                </button>
              ))}
          </div>
          <Chips items={selected} />
          <p className="small muted">
            Without explicit selections, skills are extracted from the
            description.
          </p>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {role && (
          <section className="danger-zone">
            <h4>Delete this role</h4>
            <p>
              This permanently removes its candidates, extracted text, notes,
              and activity from the application database.
            </p>
            {confirmDelete ? (
              <>
                <label>
                  Type DELETE to confirm
                  <input
                    value={deleteText}
                    onChange={(event) => setDeleteText(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <button
                  type="button"
                  className="button danger"
                  disabled={saving || deleteText !== "DELETE"}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await api(`/jobs/${role.id}?version=${role.version}`, {
                        method: "DELETE",
                      });
                      deleted?.();
                    } catch (error) {
                      setError(errorText(error));
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  Permanently delete role
                </button>
              </>
            ) : (
              <button
                type="button"
                className="danger-link"
                onClick={() => setConfirmDelete(true)}
              >
                Delete role…
              </button>
            )}
          </section>
        )}
        <div className="modal-footer">
          <button
            type="button"
            className="button secondary"
            onClick={close}
            disabled={saving}
          >
            Cancel
          </button>
          <button className="button" disabled={saving}>
            {saving ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Plus size={16} />
            )}
            {role ? "Save requirements" : "Create role"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Upload({
  role,
  close,
  done,
}: {
  role: Role;
  close: () => void;
  done: () => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [summary, setSummary] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    try {
      const result = await api<{
        added: Candidate[];
        errors: { filename: string; detail: string }[];
      }>(`/jobs/${role.id}/candidates`, { method: "POST", body: form });
      setSummary(
        `${result.added.length} candidate${result.added.length === 1 ? "" : "s"} added.`,
      );
      setFiles([]);
      await done();
      if (result.errors.length)
        setError(
          result.errors
            .map((item) => `${item.filename}: ${item.detail}`)
            .join("\n"),
        );
      else close();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  function choose(list: FileList | null) {
    if (!list) return;
    const next = Array.from(list);
    if (next.some((file) => !/\.(pdf|docx|txt)$/i.test(file.name))) {
      setError("Only PDF, DOCX, and TXT resumes are supported.");
      return;
    }
    if (next.some((file) => file.size === 0)) {
      setError("One of the selected files is empty.");
      return;
    }
    if (next.length > 10) {
      setError("Choose up to 10 files.");
      return;
    }
    if (next.some((file) => file.size > 5 * 1024 * 1024)) {
      setError("Each resume must be 5 MB or smaller.");
      return;
    }
    setError("");
    setFiles(next);
  }
  return (
    <Modal
      title="Find your next great hire."
      subtitle={`Add candidates to ${role.title}`}
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="form">
        <label
          className="dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!busy) choose(event.dataTransfer.files);
          }}
        >
          <div className="upload-symbol">
            <UploadCloud size={30} />
          </div>
          <h3>Drop resumes here</h3>
          <p>
            or <span>browse your files</span>
          </p>
          <small>PDF, DOCX, TXT · 5 MB each · up to 10 files</small>
          <input
            disabled={busy}
            type="file"
            multiple
            accept=".pdf,.docx,.txt"
            onChange={(event) => choose(event.target.files)}
          />
        </label>
        {files.length > 0 && (
          <div className="file-list">
            {files.map((file, index) => (
              <div key={`${file.name}-${index}`}>
                <FileText size={16} />
                <span>{file.name}</span>
                <small>{Math.ceil(file.size / 1024)} KB</small>
                <button
                  className="icon-button"
                  aria-label={`Remove ${file.name}`}
                  disabled={busy}
                  onClick={() =>
                    setFiles((current) => current.filter((_, i) => i !== index))
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="privacy-note">
          <ShieldCheck size={16} />
          Processed locally. Original files are not retained; extracted profiles
          and text are stored in this workspace.
        </p>
        {summary && (
          <p className="success" role="status">
            {summary}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <button className="button secondary" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            className="button"
            disabled={!files.length || busy}
            onClick={submit}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Sparkles size={16} />
            )}{" "}
            {busy
              ? "Analyzing resumes…"
              : `Analyze ${files.length || ""} resume${files.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function CandidateDetail({
  candidate,
  close,
  changed,
  removed,
}: {
  candidate: Candidate;
  close: () => void;
  changed: (candidate: Candidate) => void;
  removed: () => void;
}) {
  const [notes, setNotes] = useState(candidate.notes),
    [questions, setQuestions] = useState<Question[]>([]),
    [tab, setTab] = useState<"evidence" | "interview" | "notes">("evidence"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [conflict, setConflict] = useState<Candidate | null>(null);
  useEffect(() => {
    if (tab === "interview")
      api<{ questions: Question[] }>(`/candidates/${candidate.id}/interview`)
        .then((result) => setQuestions(result.questions))
        .catch((error) => setError(errorText(error)));
  }, [tab, candidate.id]);
  async function update(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await api<Candidate>(`/candidates/${candidate.id}`, {
        method: "PATCH",
        ...json({ ...(body as object), version: candidate.version }),
      });
      changed(result);
      setSaved(true);
    } catch (error) {
      setError(errorText(error));
      if (error instanceof ApiError && error.status === 409) {
        try {
          setConflict(await api<Candidate>(`/candidates/${candidate.id}`));
        } catch {
          /* Keep draft if the refresh also fails. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !window.confirm(
        "Delete this candidate’s profile, extracted text, scores, and notes from the application?",
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/candidates/${candidate.id}?version=${candidate.version}`, {
        method: "DELETE",
      });
      removed();
    } catch (error) {
      setError(errorText(error));
      setBusy(false);
    }
  }
  const { profile, report } = candidate;
  return (
    <Modal
      title="Candidate profile"
      subtitle={
        candidate.synthetic
          ? "Synthetic demo profile"
          : "Resume evidence & hiring conversation"
      }
      close={() => {
        if (busy) return;
        if (
          notes !== candidate.notes &&
          !window.confirm("Discard your unsaved notes?")
        )
          return;
        close();
      }}
      wide
    >
      <div className="detail">
        {conflict && (
          <div className="conflict-notice" role="alert">
            <h4>Another session saved a newer version.</h4>
            <p>
              Your draft is still here. Review the saved notes before
              continuing.
            </p>
            <details>
              <summary>Latest saved notes</summary>
              <p>{conflict.notes || "No saved notes."}</p>
            </details>
            <button
              className="button secondary"
              onClick={() => {
                changed(conflict);
                setConflict(null);
                setError("");
              }}
            >
              Use latest version and keep my draft
            </button>
          </div>
        )}
        <div className="profile-heading">
          <div className="avatar big">{initials(profile.name)}</div>
          <div>
            <h2>{profile.name}</h2>
            <p>
              <Mail size={14} />
              {profile.email || "No email extracted"}
            </p>
          </div>
          <Score value={report.score} large />
        </div>
        <div className="profile-controls">
          <Badge stage={candidate.stage} />
          <label className="stage-label">
            Move to
            <select
              aria-label="Candidate stage"
              value={candidate.stage}
              disabled={busy}
              onChange={(event) => void update({ stage: event.target.value })}
            >
              {STAGES.map((stage) => (
                <option key={stage}>{stage}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="detail-tabs">
          {(["evidence", "interview", "notes"] as const).map((value) => (
            <button
              key={value}
              className={tab === value ? "active" : ""}
              onClick={() => {
                setTab(value);
                setSaved(false);
              }}
            >
              {value === "evidence"
                ? "Match evidence"
                : value === "interview"
                  ? "Interview guide"
                  : "Private notes"}
            </button>
          ))}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {tab === "evidence" ? (
          <>
            <Breakdown report={report} />
            <h4>
              Matched requirements <span>{report.matched_skills.length}</span>
            </h4>
            <Chips items={report.matched_skills} kind="matched" />
            <h4>
              Gaps to explore <span>{report.missing_skills.length}</span>
            </h4>
            <Chips items={report.missing_skills} kind="missing" />
            <p className="small muted">
              A gap means no explicit evidence was found. It does not establish
              lack of ability.
            </p>
            <h4>From the resume</h4>
            {report.evidence.map((item) => (
              <div className="evidence" key={item.skill}>
                <span>
                  <CheckCheck size={15} />
                  {item.skill}
                </span>
                <blockquote>
                  {item.excerpt || "Skill found in extracted text."}
                </blockquote>
              </div>
            ))}
            <h4>Shared language</h4>
            <Chips items={report.shared_terms.map((term) => term.term)} />
            <h4>Experience</h4>
            <p className="resume-text">
              {profile.experience_section ||
                "No separate experience section extracted."}
            </p>
            <h4>
              Education <span>not an explicit ranking feature</span>
            </h4>
            <p className="small muted">
              {profile.education.join(" · ") || "Not extracted"}
            </p>
          </>
        ) : tab === "interview" ? (
          <>
            <p className="notice">
              <MessageSquare size={16} />
              Evidence-based question templates. No generative model or external
              service is used.
            </p>
            <QuestionList questions={questions} />
          </>
        ) : (
          <>
            <label className="notes-label">
              Notes for your review
              <textarea
                rows={7}
                maxLength={5000}
                value={notes}
                onChange={(event) => {
                  setNotes(event.target.value);
                  setSaved(false);
                }}
                placeholder="Record evidence, follow-up questions, and interview observations..."
              />
            </label>
            <button
              className="button"
              disabled={busy || saved}
              onClick={() => void update({ notes })}
            >
              {saved ? <Check size={16} /> : <MessageSquare size={16} />}{" "}
              {saved ? "Notes saved" : "Save notes"}
            </button>
          </>
        )}
        <div className="detail-bottom">
          <span>
            <Fingerprint size={14} />
            {report.model_version}
          </span>
          <button
            className="danger-link"
            disabled={busy}
            onClick={() => void remove()}
          >
            <Trash2 size={14} />
            Delete candidate
          </button>
        </div>
      </div>
    </Modal>
  );
}
function Comparison({
  candidates,
  close,
}: {
  candidates: Candidate[];
  close: () => void;
}) {
  const skills = Array.from(
    new Set(candidates.flatMap((candidate) => candidate.report.jd_skills)),
  ).sort();
  return (
    <Modal
      title="Compare the evidence."
      subtitle="Same requirements. Independent alignment scores. You make the decision."
      close={close}
      wide
    >
      <div className="comparison-scroll">
        <table className="comparison-table">
          <thead>
            <tr>
              <th scope="col">Role requirements</th>
              {candidates.map((candidate) => (
                <th scope="col" key={candidate.id}>
                  <div className="comparison-person">
                    <div className="avatar">
                      {initials(candidate.profile.name)}
                    </div>
                    <h3>{candidate.profile.name}</h3>
                    <Score value={candidate.report.score} large />
                    <Badge stage={candidate.stage} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Skill coverage</th>
              {candidates.map((candidate) => (
                <td key={candidate.id}>{candidate.report.skill_match_pct}%</td>
              ))}
            </tr>
            <tr>
              <th scope="row">Text relevance</th>
              {candidates.map((candidate) => (
                <td key={candidate.id}>
                  {candidate.report.text_similarity_pct}%
                </td>
              ))}
            </tr>
            {skills.map((skill) => (
              <tr key={skill}>
                <th scope="row">{skill}</th>
                {candidates.map((candidate) => (
                  <td key={candidate.id}>
                    {candidate.report.matched_skills.includes(skill) ? (
                      <span className="coverage yes">
                        <Check size={14} />
                        Evidence found
                      </span>
                    ) : (
                      <span className="coverage no">Explore in interview</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="notice comparison-note">
        <ShieldCheck size={16} />
        Scores organize resume evidence; they do not predict job performance.
        Missing evidence should start a conversation.
      </p>
    </Modal>
  );
}

function QuestionList({ questions }: { questions: Question[] }) {
  return (
    <div className="questions">
      {questions.map((question, index) => (
        <article key={`${question.skill}-${index}`}>
          <div>
            <span className="question-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="eyebrow">
              {question.kind} · {question.skill}
            </span>
          </div>
          <h4>{question.question}</h4>
          <p>{question.context}</p>
          <div className="look-for">
            <b>Listen for</b> {question.look_for}
          </div>
        </article>
      ))}
    </div>
  );
}

function ResumeLab({ role }: { role: Role | undefined }) {
  const [description, setDescription] = useState(role?.description || ""),
    [file, setFile] = useState<File | null>(null),
    [result, setResult] = useState<LabResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function analyze(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    const body = new FormData();
    body.append("file", file);
    body.append("job_description", description);
    try {
      setResult(await api<LabResult>("/match", { method: "POST", body }));
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <FlaskConical size={14} /> THE CANDIDATE SIDE
          </div>
          <h1>Your experience. A clearer story.</h1>
          <p>
            Understand the evidence, close the gaps, and prepare for the
            conversation.
          </p>
        </div>
        <span className="pill">
          <ShieldCheck size={14} />
          No profile saved
        </span>
      </div>
      <div className="lab-grid">
        <form className="panel lab-form" onSubmit={analyze}>
          <div className="panel-title">
            <div className="section-symbol">
              <FileText size={19} />
            </div>
            <div>
              <h3>Start with your resume</h3>
              <p>Analyze locally. Keep control of your data.</p>
            </div>
          </div>
          <label className="file-input-label">
            Resume file
            <input
              type="file"
              required
              accept=".pdf,.docx,.txt"
              onChange={(event) => {
                setFile(event.target.files?.[0] || null);
                setResult(null);
              }}
            />
          </label>
          <label>
            Target job description
            <textarea
              rows={12}
              required
              minLength={30}
              maxLength={20000}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setResult(null);
              }}
              placeholder="Paste the role you want to apply for..."
            />
          </label>
          <p className="small muted">
            PDF, DOCX, TXT · up to 5 MB. This analysis is transient and does not
            add you to a hiring pipeline.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button full" disabled={busy || !file}>
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <WandSparkles size={17} />
            )}{" "}
            {busy ? "Finding your evidence…" : "Analyze my alignment"}
          </button>
        </form>
        <div className="lab-results">
          {result ? (
            <>
              <div className="panel lab-score">
                <div>
                  <span className="eyebrow">YOUR ALIGNMENT</span>
                  <h2>{result.match.verdict}</h2>
                  <p>
                    Hi {result.resume.name.split(" ")[0]}, here’s what the
                    resume makes visible.
                  </p>
                </div>
                <Score value={result.match.score} large />
                <Breakdown report={result.match} />
              </div>
              <div className="panel">
                <h3>Your strengths</h3>
                <Chips items={result.match.matched_skills} kind="matched" />
                <h3 className="space-top">Your next moves</h3>
                {result.match.missing_skills.length ? (
                  result.match.missing_skills.map((skill, index) => (
                    <div className="learning-step" key={skill}>
                      <span>{index + 1}</span>
                      <div>
                        <b>Build evidence for {skill}</b>
                        <p>
                          If you know it, add a specific project and outcome to
                          your resume. Otherwise, build a small project,
                          document the tradeoffs, and test what you learned.
                        </p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted">
                    Every recognized role skill has evidence. Strengthen the
                    story with measurable outcomes and prepare to discuss
                    tradeoffs.
                  </p>
                )}
                <p className="notice">
                  <ShieldCheck size={16} />
                  Keep your resume truthful. An alignment score is a retrieval
                  signal, not a hiring prediction.
                </p>
              </div>
              <div className="panel">
                <h3>Practice the conversation</h3>
                <p className="small muted">
                  Questions tailored through evidence-based templates.
                </p>
                <QuestionList questions={result.interview} />
              </div>
            </>
          ) : (
            <div className="panel lab-empty">
              <div className="lab-art">
                <div className="orbit one" />
                <div className="orbit two" />
                <div className="lab-orb">
                  <Sparkles size={35} />
                </div>
                <div className="floating-chip">
                  <Check size={13} /> Your next chapter
                </div>
              </div>
              <h2>
                Great work deserves
                <br />a great introduction.
              </h2>
              <p>
                See the skills your resume communicates, the evidence a
                recruiter can find, and questions worth practicing.
              </p>
              <div className="lab-promises">
                <span>
                  <Check size={15} />
                  Explainable scoring
                </span>
                <span>
                  <Check size={15} />
                  No external AI API
                </span>
                <span>
                  <Check size={15} />
                  No resume storage in this flow
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ModelCard() {
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <Fingerprint size={14} /> BUILT TO BE UNDERSTOOD
          </div>
          <h1>Intelligence without the black box.</h1>
          <p>
            A useful signal starts with an honest explanation of what it
            measures.
          </p>
        </div>
        <span className="pill">Model card · v1</span>
      </div>
      <div className="model-hero panel">
        <div>
          <span className="eyebrow">LOCAL MACHINE LEARNING</span>
          <h2>
            Rank the evidence.
            <br />
            Keep people in the decision.
          </h2>
          <p>
            TalentOS combines explicit skill coverage with word and character
            TF-IDF similarity. Every score can be traced back to the resume. No
            external API, neural embeddings, or language model is used.
          </p>
        </div>
        <div className="formula">
          <div>
            <b>
              65<span>%</span>
            </b>
            <span>Skill coverage</span>
          </div>
          <Plus size={24} />
          <div>
            <b>
              35<span>%</span>
            </b>
            <span>Text relevance</span>
          </div>
        </div>
      </div>
      <div className="model-cards">
        {[
          [
            Target,
            "What it measures",
            "Coverage of canonical role skills and lexical relevance. Text relevance blends word/bigram cosine similarity (80%) with character n-grams (20%). Each document pair is fitted independently so adding another candidate does not change existing scores.",
          ],
          [
            ShieldCheck,
            "What it leaves out",
            "Name and contact details are removed from the text signal. Protected attributes and school prestige are not explicit features. Free text can contain proxies, so this is not a guarantee of unbiased ranking.",
          ],
          [
            CircleHelp,
            GitCompareArrows,
            Pencil,
            "Where it can fail",
            "Keyword stuffing, short resumes, unusual synonyms, and scanned PDFs can reduce quality. This is not a trained predictor of job performance. Scores are not probabilities and should never be automatic rejection thresholds.",
          ],
          [
            LockKeyhole,
            "Your data, your workspace",
            "Resume Lab requests are transient. Recruiter uploads retain extracted text and profiles locally, not original files. A shared workspace access key is available; production requires it. Multi-tenant access control is outside this release.",
          ],
        ].map(([Icon, title, body]) => {
          const Component = Icon as typeof Target;
          return (
            <article className="panel" key={String(title)}>
              <Component size={23} />
              <h3>{String(title)}</h3>
              <p>{String(body)}</p>
            </article>
          );
        })}
      </div>
      <div className="panel model-foot">
        <Code2 size={20} />
        <div>
          <h3>Engineering you can inspect</h3>
          <p>
            FastAPI · React + TypeScript · SQLAlchemy · scikit-learn · SQLite /
            PostgreSQL · Docker · automated integration tests
          </p>
        </div>
        <span className="pill">tfidf-word-char-v1</span>
      </div>
    </>
  );
}

export default function App() {
  const [view, setView] = useState<View>("overview"),
    [jobs, setJobs] = useState<Role[]>([]),
    [jobId, setJobId] = useState(""),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [activity, setActivity] = useState<Activity[]>([]),
    [catalog, setCatalog] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [query, setQuery] = useState(""),
    [stage, setStage] = useState("All stages"),
    [modal, setModal] = useState<"role" | "upload" | "edit" | "compare" | null>(
      null,
    ),
    [detail, setDetail] = useState<Candidate | null>(null),
    [authRequired, setAuthRequired] = useState(false),
    [authed, setAuthed] = useState(false),
    [accessKey, setAccessKey] = useState(""),
    [comparison, setComparison] = useState<string[]>([]),
    [loginBusy, setLoginBusy] = useState(false);
  const role = jobs.find((job) => job.id === jobId);
  const requestVersion = useRef(0);
  const authEpoch = useRef(0);
  useEffect(() => {
    const lock = () => {
      authEpoch.current++;
      requestVersion.current++;
      setAuthed(false);
      setAuthRequired(true);
      setDetail(null);
      setModal(null);
      setCandidates([]);
      setJobs([]);
      setActivity([]);
      setAccessKey("");
      setError(
        "Your access key is no longer valid. Unlock the workspace to continue.",
      );
    };
    window.addEventListener("talentos:locked", lock);
    return () => window.removeEventListener("talentos:locked", lock);
  }, []);
  const notify = (message: string) => setToast(message);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const loadJobs = useCallback(async () => {
    const epoch = authEpoch.current;
    const rows = await api<Role[]>("/jobs");
    if (epoch !== authEpoch.current) return rows;
    setJobs(rows);
    setJobId((current) =>
      rows.some((row) => row.id === current) ? current : rows[0]?.id || "",
    );
    return rows;
  }, []);
  useEffect(() => {
    api<{ auth_required: boolean }>("/meta")
      .then((meta) => {
        setAuthRequired(meta.auth_required);
        setAuthed(
          !meta.auth_required || !!sessionStorage.getItem("talentos-key"),
        );
      })
      .catch((error) => {
        setError(errorText(error));
        setLoading(false);
      });
  }, []);
  useEffect(() => {
    if (!authed) return;
    setLoading(true);
    Promise.all([loadJobs(), api<string[]>("/skills").then(setCatalog)])
      .catch((error) => setError(errorText(error)))
      .finally(() => setLoading(false));
  }, [authed, loadJobs]);
  const refresh = useCallback(async () => {
    if (!jobId) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError("");
    try {
      const [result, events] = await Promise.all([
        api<{ items: Candidate[] }>(`/jobs/${jobId}/candidates?limit=500`),
        api<Activity[]>(`/jobs/${jobId}/activity`),
      ]);
      if (version === requestVersion.current) {
        setCandidates(result.items);
        setActivity(events);
      }
    } catch (error) {
      if (version === requestVersion.current) setError(errorText(error));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [jobId]);
  useEffect(() => {
    setCandidates([]);
    setActivity([]);
    setQuery("");
    setStage("All stages");
    setComparison([]);
    void refresh();
    return () => {
      requestVersion.current++;
    };
  }, [refresh]);
  async function updateStage(candidate: Candidate, next: Stage) {
    try {
      const updated = await api<Candidate>(`/candidates/${candidate.id}`, {
        method: "PATCH",
        ...json({ stage: next, version: candidate.version }),
      });
      setCandidates((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      notify(`Moved to ${next}`);
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refresh();
      setError(errorText(error));
    }
  }
  async function download() {
    try {
      const response = await request(`/jobs/${jobId}/export`);
      if (!response.ok)
        throw new Error("Export failed. Check workspace access.");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "talentos-candidates.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Candidate report exported");
    } catch (error) {
      setError(errorText(error));
    }
  }
  const filtered = candidates.filter(
    (candidate) =>
      (stage === "All stages" || candidate.stage === stage) &&
      `${candidate.profile.name} ${candidate.profile.email || ""} ${candidate.profile.skills.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const average = candidates.length
    ? Math.round(
        candidates.reduce((sum, candidate) => sum + candidate.report.score, 0) /
          candidates.length,
      )
    : 0;
  const strong = candidates.filter(
    (candidate) => candidate.report.score >= 75,
  ).length;
  const shortlisted = candidates.filter((candidate) =>
    ["Shortlisted", "Interview", "Offer"].includes(candidate.stage),
  ).length;
  function navigate(next: View) {
    setView(next);
    setError("");
  }
  if (authRequired && !authed)
    return (
      <main className="login">
        <div className="login-card panel">
          <div className="brand">
            <span className="brand-mark">
              t<span>•</span>
            </span>
            talent<span className="brand-os">os</span>
          </div>
          <h1>Your workspace awaits.</h1>
          <p>Enter the workspace access key to continue.</p>
          <form
            className="form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (loginBusy) return;
              setLoginBusy(true);
              sessionStorage.setItem("talentos-key", accessKey);
              try {
                await api("/jobs");
                setAuthed(true);
                setError("");
              } catch (error) {
                sessionStorage.removeItem("talentos-key");
                setError(errorText(error));
              } finally {
                setLoginBusy(false);
              }
            }}
          >
            <label>
              Workspace access key
              <input
                type="password"
                required
                autoComplete="current-password"
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="button full" disabled={loginBusy}>
              {loginBusy ? "Unlocking…" : "Unlock workspace"}
              <ArrowRight size={16} />
            </button>
          </form>
        </div>
      </main>
    );
  return (
    <div className="app">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-mark">
            t<span>•</span>
          </span>
          talent<span className="brand-os">os</span>
          <span className="brand-dot" />
        </a>
        <div className="workspace">
          <div className="workspace-icon">W</div>
          <div>
            <b>My workspace</b>
            <small>Candidate intelligence</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(
            [
              [LayoutDashboard, "overview", "Overview"],
              [BriefcaseBusiness, "roles", "Open roles"],
              [Users, "pipeline", "Hiring pipeline"],
            ] as const
          ).map(([Icon, value, label]) => (
            <button
              key={value}
              className={view === value ? "active" : ""}
              onClick={() => navigate(value)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {value === "roles" && <small>{jobs.length}</small>}
              {view === value && <i />}
            </button>
          ))}
        </nav>
        <div className="nav-label tools-label">INTELLIGENCE</div>
        <nav aria-label="Intelligence tools">
          <button
            className={view === "lab" ? "active" : ""}
            onClick={() => navigate("lab")}
          >
            <FlaskConical size={18} />
            <span>Resume Lab</span>
            <span className="new-badge">NEW</span>
          </button>
          <button
            className={view === "model" ? "active" : ""}
            onClick={() => navigate("model")}
          >
            <Fingerprint size={18} />
            <span>Model & trust</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-icon">
              <Sparkles size={19} />
            </span>
            <h4>
              Better signals.
              <br />
              Better conversations.
            </h4>
            <p>See the evidence behind every candidate’s alignment.</p>
            <button onClick={() => navigate("model")}>
              Explore the model
              <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="account">
            <div className="avatar">MW</div>
            <div>
              <b>My workspace</b>
              <small>
                {authRequired ? "Protected workspace" : "Local development"}
              </small>
            </div>
            {authRequired ? (
              <button
                className="icon-button"
                aria-label="Lock workspace"
                onClick={() => {
                  sessionStorage.removeItem("talentos-key");
                  setAuthed(false);
                  setAccessKey("");
                }}
              >
                <LockKeyhole size={17} />
              </button>
            ) : (
              <ShieldCheck size={18} />
            )}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={14} />
            <span>{titles[view]}</span>
          </div>
          <div className="topbar-right">
            <span className="live-label">
              <i />
              Local intelligence
            </span>
            <button
              className="icon-button"
              aria-label="About scoring and data privacy"
              onClick={() => navigate("model")}
            >
              <CircleHelp size={19} />
            </button>
            <div className="avatar small-avatar">MW</div>
          </div>
        </header>
        <main className="content" id="main-content">
          {error && (
            <div className="error-banner" role="alert">
              <CircleHelp size={18} />
              <span>{error}</span>
              <button
                className="text-button"
                onClick={() =>
                  void (jobId
                    ? refresh()
                    : loadJobs().catch((error) => setError(errorText(error))))
                }
              >
                Retry
              </button>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "lab" ? (
            <ResumeLab role={role} />
          ) : view === "model" ? (
            <ModelCard />
          ) : view === "roles" ? (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">BUILD YOUR NEXT GREAT TEAM</div>
                  <h1>Every role. A new possibility.</h1>
                  <p>
                    A clear brief is the beginning of a better hiring
                    conversation.
                  </p>
                </div>
                <button className="button" onClick={() => setModal("role")}>
                  <Plus size={17} />
                  Create role
                </button>
              </div>
              <div className="roles-grid">
                {jobs.map((job) => (
                  <button
                    className="panel role-card"
                    key={job.id}
                    onClick={() => {
                      setJobId(job.id);
                      navigate("overview");
                    }}
                  >
                    <div className="role-card-top">
                      <span className="role-symbol">
                        <Code2 size={23} />
                      </span>
                      <span className="pill green">
                        <i />
                        Open
                      </span>
                    </div>
                    <p className="eyebrow">{job.department}</p>
                    <h2>{job.title}</h2>
                    <p>
                      <MapPin size={14} />
                      {job.location}
                    </p>
                    <Chips items={job.required_skills.slice(0, 5)} />
                    <div className="role-card-bottom">
                      <span>
                        <Users size={15} />
                        {job.candidate_count} candidates
                      </span>
                      <ArrowUpRight size={19} />
                    </div>
                  </button>
                ))}
                <button
                  className="new-role-card"
                  onClick={() => setModal("role")}
                >
                  <Plus size={27} />
                  <h3>Your next great hire starts here</h3>
                  <p>Create a role and define what matters.</p>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-line" />
                    YOUR PEOPLE, YOUR POSSIBILITIES
                  </div>
                  <h1>
                    {view === "pipeline"
                      ? "Move great talent forward."
                      : "Find the people who move you forward."}
                  </h1>
                  <p>
                    {view === "pipeline"
                      ? "A thoughtful process. A clearer view of what comes next."
                      : "Less guesswork. More evidence. Your next great hire starts here."}
                  </p>
                </div>
                <button
                  className="button secondary heading-export"
                  onClick={() => void download()}
                  disabled={!role || !candidates.length}
                >
                  <ArrowDownToLine size={16} />
                  Export report
                </button>
              </div>
              <div className="role-toolbar">
                <div className="role-selection">
                  <span className="role-symbol">
                    <Code2 size={20} />
                  </span>
                  <div>
                    <span className="small muted">ACTIVE ROLE</span>
                    <div className="select-wrap">
                      <select
                        aria-label="Active role"
                        value={jobId}
                        onChange={(event) => setJobId(event.target.value)}
                      >
                        {!jobs.length && (
                          <option value="">No open roles</option>
                        )}
                        {jobs.map((job) => (
                          <option value={job.id} key={job.id}>
                            {job.title}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} />
                    </div>
                  </div>
                </div>
                <div className="role-info">
                  <span>
                    <MapPin size={14} />
                    {role?.location || "Create your first role"}
                  </span>
                  <span className="pill green">
                    <i />
                    Accepting candidates
                  </span>
                  <button
                    className="icon-button"
                    aria-label={role ? "Edit active role" : "Create a new role"}
                    onClick={async () => {
                      if (!role) {
                        setModal("role");
                        return;
                      }
                      try {
                        await loadJobs();
                        setModal("edit");
                      } catch (error) {
                        setError(errorText(error));
                      }
                    }}
                  >
                    {role ? <Pencil size={19} /> : <Plus size={19} />}
                  </button>
                </div>
              </div>
              <div className="stats-grid">
                <Stat
                  icon={<Users size={19} />}
                  label="Total candidates"
                  value={String(candidates.length)}
                  detail="People in this role’s pipeline"
                />
                <Stat
                  icon={<Sparkles size={19} />}
                  label="Strong alignments"
                  value={String(strong).padStart(2, "0")}
                  detail="75+ alignment · review the evidence"
                  tone="green"
                />
                <Stat
                  icon={<BarChart3 size={19} />}
                  label="Average alignment"
                  value={`${average}%`}
                  detail="Across all candidates in this role"
                />
                <Stat
                  icon={<CheckCheck size={19} />}
                  label="Moving forward"
                  value={String(shortlisted).padStart(2, "0")}
                  detail="Shortlisted, interviewing, or offer"
                  tone="purple"
                />
              </div>
              {view === "pipeline" ? (
                <div className="pipeline">
                  {STAGES.map((status) => (
                    <section className="pipeline-column" key={status}>
                      <div className="column-heading">
                        <Badge stage={status} />
                        <b>
                          {
                            candidates.filter(
                              (candidate) => candidate.stage === status,
                            ).length
                          }
                        </b>
                      </div>
                      {candidates
                        .filter((candidate) => candidate.stage === status)
                        .map((candidate) => (
                          <article className="pipeline-card" key={candidate.id}>
                            <button
                              className="candidate-card-button"
                              onClick={() => setDetail(candidate)}
                            >
                              <div className="pipeline-person">
                                <div className="avatar">
                                  {initials(candidate.profile.name)}
                                </div>
                                <Score value={candidate.report.score} />
                              </div>
                              <h3>{candidate.profile.name}</h3>
                              <p>{candidate.report.verdict}</p>
                              <Chips
                                items={candidate.report.matched_skills.slice(
                                  0,
                                  3,
                                )}
                              />
                            </button>
                            <label className="small muted">
                              Move to
                              <select
                                aria-label={`Move ${candidate.profile.name} to stage`}
                                value={candidate.stage}
                                onChange={(event) =>
                                  void updateStage(
                                    candidate,
                                    event.target.value as Stage,
                                  )
                                }
                              >
                                {STAGES.map((stage) => (
                                  <option key={stage}>{stage}</option>
                                ))}
                              </select>
                            </label>
                          </article>
                        ))}
                      {!candidates.some(
                        (candidate) => candidate.stage === status,
                      ) && (
                        <div className="pipeline-empty">
                          A little room for possibility.
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              ) : (
                <div className="dashboard-grid">
                  <section className="panel candidates-panel">
                    <div className="panel-header">
                      <div>
                        <h3>
                          Candidate shortlist{" "}
                          <span className="count">{candidates.length}</span>
                        </h3>
                        <p>Ordered by evidence. Reviewed by you.</p>
                      </div>
                      <button
                        className="button"
                        disabled={!role}
                        onClick={() => setModal("upload")}
                      >
                        <Plus size={16} />
                        Add candidates
                      </button>
                    </div>
                    <div className="comparison-toolbar">
                      <span>Select 2–3 people for a side-by-side review.</span>
                      <button
                        className="button secondary"
                        disabled={comparison.length < 2}
                        onClick={() => setModal("compare")}
                      >
                        <GitCompareArrows size={15} />
                        Compare
                        {comparison.length > 0 ? ` (${comparison.length})` : ""}
                      </button>
                    </div>
                    <div className="table-toolbar">
                      <div className="search">
                        <Search size={17} />
                        <input
                          aria-label="Search candidates"
                          placeholder="Search name, email, or skill..."
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </div>
                      <label className="filter">
                        <ListFilter size={15} />
                        <select
                          aria-label="Filter pipeline stage"
                          value={stage}
                          onChange={(event) => setStage(event.target.value)}
                        >
                          <option>All stages</option>
                          {STAGES.map((stage) => (
                            <option key={stage}>{stage}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {loading ? (
                      <div className="loading">
                        <LoaderCircle className="spin" size={22} />
                        Loading your workspace…
                      </div>
                    ) : filtered.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th scope="col">
                                <span className="sr-only">
                                  Select for comparison
                                </span>
                              </th>
                              <th scope="col">Candidate</th>
                              <th>
                                <span>
                                  Alignment
                                  <ArrowDown size={12} />
                                </span>
                              </th>
                              <th>Top skills</th>
                              <th>Stage</th>
                              <th>
                                <span className="sr-only">View profile</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.map((candidate, index) => (
                              <tr key={candidate.id}>
                                <td className="selection-cell">
                                  <input
                                    type="checkbox"
                                    aria-label={`Compare ${candidate.profile.name}`}
                                    checked={comparison.includes(candidate.id)}
                                    disabled={
                                      comparison.length >= 3 &&
                                      !comparison.includes(candidate.id)
                                    }
                                    onChange={() =>
                                      setComparison((current) =>
                                        current.includes(candidate.id)
                                          ? current.filter(
                                              (id) => id !== candidate.id,
                                            )
                                          : [...current, candidate.id],
                                      )
                                    }
                                  />
                                </td>
                                <td>
                                  <button
                                    className="person"
                                    onClick={() => setDetail(candidate)}
                                  >
                                    <span
                                      className={`avatar color-${index % 4}`}
                                    >
                                      {initials(candidate.profile.name)}
                                    </span>
                                    <span>
                                      <b>{candidate.profile.name}</b>
                                      <small>
                                        {candidate.profile.email ||
                                          candidate.filename}
                                      </small>
                                    </span>
                                  </button>
                                </td>
                                <td>
                                  <button
                                    className="score-link"
                                    onClick={() => setDetail(candidate)}
                                    aria-label={`View ${candidate.profile.name} alignment evidence`}
                                  >
                                    <Score value={candidate.report.score} />
                                  </button>
                                </td>
                                <td>
                                  <div className="table-skills">
                                    {candidate.profile.skills
                                      .slice(0, 2)
                                      .map((skill) => (
                                        <span key={skill}>{skill}</span>
                                      ))}
                                    {candidate.profile.skills.length > 2 && (
                                      <small>
                                        +{candidate.profile.skills.length - 2}
                                      </small>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <Badge stage={candidate.stage} />
                                </td>
                                <td>
                                  <button
                                    className="icon-button"
                                    aria-label={`View ${candidate.profile.name}`}
                                    onClick={() => setDetail(candidate)}
                                  >
                                    <ArrowUpRight size={17} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        icon={<Users size={26} />}
                        title={
                          candidates.length
                            ? "No candidates match your filters"
                            : "Great teams start with one person."
                        }
                      >
                        {candidates.length
                          ? "Try another name or skill, or reset the stage filter."
                          : "Upload a resume to turn experience into clear, reviewable evidence."}
                      </Empty>
                    )}
                    <div className="table-footer">
                      <span>
                        {filtered.length} of {candidates.length} candidates
                      </span>
                      <span>
                        <ShieldCheck size={13} />
                        Human review, always.
                      </span>
                    </div>
                  </section>
                  <aside className="insights">
                    <section className="insight-card">
                      <div className="insight-label">
                        <Sparkles size={15} />
                        ROLE INTELLIGENCE<span>LOCAL ML</span>
                      </div>
                      <h3>
                        Look beyond
                        <br />
                        the keywords.
                      </h3>
                      <p>
                        Your shortlist blends required skills with text
                        relevance, with evidence at every step.
                      </p>
                      <div className="weight-row">
                        <span>Skill coverage</span>
                        <b>65%</b>
                      </div>
                      <div className="segment-bar">
                        <i />
                        <span />
                      </div>
                      <div className="weight-row muted">
                        <span>Text relevance</span>
                        <b>35%</b>
                      </div>
                      <button onClick={() => navigate("model")}>
                        See how scoring works
                        <ArrowRight size={15} />
                      </button>
                      <div className="insight-decoration" />
                    </section>
                    <section className="panel requirements-card">
                      <div className="small-heading">
                        <h3>What matters here</h3>
                        <Target size={17} />
                      </div>
                      <p className="small muted">
                        Required skills for this role
                      </p>
                      <Chips items={role?.required_skills || []} />
                      <div className="requirements-foot">
                        <span>{role?.department || "Your team"}</span>
                        <span>Role requirements</span>
                      </div>
                    </section>
                  </aside>
                </div>
              )}
              <div className="bottom-grid">
                <section className="panel activity-panel">
                  <div className="small-heading">
                    <h3>
                      <ActivityIcon size={17} />
                      Workspace activity
                    </h3>
                    <span className="small muted">Latest events</span>
                  </div>
                  {activity.length ? (
                    activity.slice(0, 3).map((item, index) => (
                      <div className="activity-item" key={item.id}>
                        <span
                          className={`activity-dot ${index === 0 ? "fresh" : ""}`}
                        />
                        <div>
                          <b>{item.action}</b>
                          <p>{item.detail}</p>
                        </div>
                        <time dateTime={item.created_at}>
                          {new Date(item.created_at).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </time>
                      </div>
                    ))
                  ) : (
                    <p className="small muted">
                      Your role’s activity will appear here.
                    </p>
                  )}
                </section>
                <button
                  className="candidate-cta"
                  onClick={() => navigate("lab")}
                >
                  <div>
                    <span className="eyebrow">
                      ON THE OTHER SIDE OF THE TABLE?
                    </span>
                    <h3>Your next chapter starts with clarity.</h3>
                    <p>Explore your resume from a recruiter’s perspective.</p>
                    <span className="cta-link">
                      Try Resume Lab
                      <ArrowUpRight size={15} />
                    </span>
                  </div>
                  <div className="cta-icon">
                    <FlaskConical size={38} />
                  </div>
                </button>
              </div>
              <div className="workspace-disclosure">
                <ShieldCheck size={14} />
                {candidates.some((candidate) => candidate.synthetic)
                  ? "Demo profiles are synthetic. Scores support review; they do not predict hiring outcomes."
                  : "Scores support review. Always assess the evidence and discuss gaps with the candidate."}
                <button onClick={() => navigate("model")}>
                  Our approach
                  <ArrowUpRight size={12} />
                </button>
              </div>
            </>
          )}
        </main>
        <footer className="app-footer">
          <span>
            talentos <i />
            Built for thoughtful hiring.
          </span>
          <span>
            Explainable by design
            <ShieldCheck size={12} />
          </span>
        </footer>
      </div>
      {modal === "role" && (
        <NewRole
          catalog={catalog}
          close={() => setModal(null)}
          created={(newRole) => {
            setJobs((current) => [...current, newRole]);
            setJobId(newRole.id);
            setModal(null);
            navigate("overview");
            notify("Role created. Ready for your first candidate.");
          }}
        />
      )}
      {modal === "edit" && role && (
        <NewRole
          key={`${role.id}-${role.version}`}
          catalog={catalog}
          role={role}
          close={() => setModal(null)}
          created={(updated) => {
            setJobs((current) =>
              current.map((job) => (job.id === updated.id ? updated : job)),
            );
            setModal(null);
            void refresh();
            notify("Role saved. Candidate alignment has been recalculated.");
          }}
          deleted={() => {
            setModal(null);
            setDetail(null);
            setCandidates([]);
            void loadJobs();
            notify("Role and its candidate records deleted.");
          }}
        />
      )}
      {modal === "compare" && (
        <Comparison
          candidates={candidates.filter((candidate) =>
            comparison.includes(candidate.id),
          )}
          close={() => setModal(null)}
        />
      )}
      {modal === "upload" && role && (
        <Upload
          role={role}
          close={() => setModal(null)}
          done={async () => {
            await refresh();
            await loadJobs();
            notify("Candidate analysis completed");
          }}
        />
      )}
      {detail && (
        <CandidateDetail
          key={detail.id}
          candidate={detail}
          close={() => setDetail(null)}
          changed={(updated) => {
            setDetail(updated);
            setCandidates((current) =>
              current.map((candidate) =>
                candidate.id === updated.id ? updated : candidate,
              ),
            );
            void refresh();
          }}
          removed={() => {
            setDetail(null);
            void refresh();
            void loadJobs();
            notify("Candidate removed");
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={16} />
          </span>
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function Stat({
  icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <div>
        <span>{label}</span>
        <i>{icon}</i>
      </div>
      <b>{value}</b>
      <p>{detail}</p>
    </article>
  );
}
