export type Stage = "New" | "Shortlisted" | "Interview" | "Offer" | "Rejected";
export const STAGES: Stage[] = [
  "New",
  "Shortlisted",
  "Interview",
  "Offer",
  "Rejected",
];
export interface Role {
  version: number;
  id: string;
  title: string;
  department: string;
  location: string;
  description: string;
  required_skills: string[];
  candidate_count: number;
  created_at: string;
}
export interface Profile {
  name: string;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  github: string | null;
  skills: string[];
  education: string[];
  experience_section: string;
  projects_section: string;
  word_count: number;
}
export interface Report {
  score: number;
  skill_match_pct: number;
  text_similarity_pct: number;
  matched_skills: string[];
  missing_skills: string[];
  extra_skills: string[];
  jd_skills: string[];
  verdict: string;
  evidence: { skill: string; excerpt: string }[];
  shared_terms: { term: string; weight: number }[];
  model_version: string;
  warnings: string[];
}
export interface Candidate {
  version: number;
  id: string;
  job_id: string;
  filename: string;
  profile: Profile;
  report: Report;
  stage: Stage;
  notes: string;
  synthetic: boolean;
  created_at: string;
}
export interface Question {
  kind: string;
  skill: string;
  question: string;
  context: string;
  look_for: string;
}
export interface Activity {
  id: string;
  action: string;
  detail: string;
  created_at: string;
}
export interface LabResult {
  resume: Profile;
  match: Report;
  interview: Question[];
}
