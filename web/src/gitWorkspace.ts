// Puente tipado Git (A6) — sin push / force / reset hard.

import { invoke } from "@tauri-apps/api/core";

export interface GitStatusEntry {
  path: string;
  index: string;
  worktree: string;
}

export interface GitStatusReport {
  root: string;
  branch: string;
  dirty: boolean;
  entries: GitStatusEntry[];
  raw: string;
}

export interface GitDiffReport {
  root: string;
  patch: string;
}

export interface GitBranchReport {
  root: string;
  current: string;
  branches: string[];
}

export interface GitCommitReport {
  root: string;
  ok: boolean;
  summary: string;
}

export function gitStatus(): Promise<GitStatusReport> {
  return invoke<GitStatusReport>("git_status");
}

export function gitDiff(): Promise<GitDiffReport> {
  return invoke<GitDiffReport>("git_diff");
}

export function gitBranches(): Promise<GitBranchReport> {
  return invoke<GitBranchReport>("git_branches");
}

export function gitCommit(message: string, confirmed: boolean): Promise<GitCommitReport> {
  return invoke<GitCommitReport>("git_commit", { message, confirmed });
}

export function gitCheckout(name: string, create: boolean): Promise<GitBranchReport> {
  return invoke<GitBranchReport>("git_checkout", { name, create });
}
