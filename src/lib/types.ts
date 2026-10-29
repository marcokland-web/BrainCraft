// Datenformen wie in bc_pull und braincraft.payload_ok

export type QuestionType =
  | 'multiple_choice'
  | 'word_clicker'
  | 'sort_boxes'
  | 'detective'
  | 'bubble_pop'
  | 'pair_matching'
  | 'sequencing'

export interface MultipleChoice {
  options: string[]
  correct_index: number
  explanation: string
}
export interface WordClicker {
  sentence_with_gap: string
  correct_word: string
  distractors: string[]
}
export interface SortBoxes {
  categories: string[]
  items: { text: string; category_index: number }[]
}
export interface Detective {
  statements: { text: string; is_impostor: boolean }[]
  reveal_text: string
}
export interface BubblePop {
  target_rule: string
  bubbles: { text: string; is_correct: boolean }[]
}
export interface PairMatching {
  pairs: { left: string; right: string }[]
}
export interface Sequencing {
  correct_order: string[]
}

export type Question =
  | { id: string; exam_id: string; type: 'multiple_choice'; prompt: string; payload: MultipleChoice }
  | { id: string; exam_id: string; type: 'word_clicker'; prompt: string; payload: WordClicker }
  | { id: string; exam_id: string; type: 'sort_boxes'; prompt: string; payload: SortBoxes }
  | { id: string; exam_id: string; type: 'detective'; prompt: string; payload: Detective }
  | { id: string; exam_id: string; type: 'bubble_pop'; prompt: string; payload: BubblePop }
  | { id: string; exam_id: string; type: 'pair_matching'; prompt: string; payload: PairMatching }
  | { id: string; exam_id: string; type: 'sequencing'; prompt: string; payload: Sequencing }

// Lernstand je Kind und Frage (braincraft.progress)
export interface Progress {
  question_id: string
  leitner_box: number // 1 Holz … 5 Sternenstahl
  next_review_at: string
  consecutive_correct: number
}

export interface Exam {
  id: string
  title: string
  exam_date: string | null
}

// Ergebnis eines Minispiels an die Arena
export interface GameResult {
  mistakes: number
}
