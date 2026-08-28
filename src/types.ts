export interface ActionItem {
  task: string;
  assignee: string;
  deadline?: string;
}

export interface MeetingMinutes {
  summary: string;
  actionItems: ActionItem[];
  speakers?: string[];
}
