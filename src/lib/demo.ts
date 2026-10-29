import type { Exam, Question } from './types'

// Probe-Klassenarbeit, solange noch keine Familie verbunden ist (Lernstoff bleibt Deutsch, wie gescannte Inhalte)
export const DEMO_EXAM: Exam = { id: 'demo', title: 'Der Wasserkreislauf', exam_date: null }

export const DEMO_SLIDES = [
  {
    title: 'Wasser verdunstet',
    content: 'Die Sonne erwärmt das Wasser in Meeren, Seen und Flüssen. Das Wasser verdunstet und steigt als Wasserdampf nach oben.',
    keywords: ['Sonne', 'verdunsten', 'Wasserdampf'],
  },
  {
    title: 'Wolken entstehen',
    content: 'Oben in der Luft ist es kalt. Der Wasserdampf kondensiert zu winzigen Tröpfchen, und daraus werden Wolken.',
    keywords: ['kondensieren', 'Wolken'],
  },
  {
    title: 'Niederschlag',
    content: 'Werden die Tropfen zu schwer, fallen sie als Niederschlag zur Erde: als Regen, Schnee oder Hagel.',
    keywords: ['Regen', 'Schnee', 'Hagel'],
  },
  {
    title: 'Zurück ins Meer',
    content: 'Das Wasser versickert im Boden und wird zu Grundwasser oder fließt über Bäche und Flüsse zurück ins Meer. Wasser geht nie verloren.',
    keywords: ['Grundwasser', 'Kreislauf'],
  },
]

const q = <T extends Question>(x: Omit<T, 'exam_id'>) => ({ ...x, exam_id: 'demo' }) as T

export const DEMO_QUESTIONS: Question[] = [
  q({
    id: 'd1', type: 'multiple_choice', prompt: 'Was lässt das Wasser im Meer verdunsten?',
    payload: { options: ['Die Sonne', 'Der Mond', 'Der Wind allein', 'Die Fische'], correct_index: 0,
      explanation: 'Die Sonne erwärmt das Wasser. Warmes Wasser verdunstet.' },
  }),
  q({
    id: 'd2', type: 'word_clicker', prompt: 'Setze das passende Wort ein:',
    payload: { sentence_with_gap: 'Oben in der Luft [GAP] der Wasserdampf zu Tröpfchen.', correct_word: 'kondensiert',
      distractors: ['schmilzt', 'versickert', 'gefriert'] },
  }),
  q({
    id: 'd3', type: 'sort_boxes', prompt: 'Sortiere: Was ist Niederschlag, was nicht?',
    payload: { categories: ['Niederschlag', 'Kein Niederschlag'],
      items: [
        { text: 'Regen', category_index: 0 }, { text: 'Schnee', category_index: 0 }, { text: 'Hagel', category_index: 0 },
        { text: 'Wind', category_index: 1 }, { text: 'Sonnenschein', category_index: 1 }, { text: 'Grundwasser', category_index: 1 },
      ] },
  }),
  q({
    id: 'd4', type: 'detective', prompt: 'Welcher Satz stimmt nicht?',
    payload: { statements: [
      { text: 'Wolken bestehen aus winzigen Wassertröpfchen.', is_impostor: false },
      { text: 'Beim Wasserkreislauf geht jeden Tag Wasser für immer verloren.', is_impostor: true },
      { text: 'Regen kann im Boden zu Grundwasser werden.', is_impostor: false },
    ], reveal_text: 'Gut entlarvt! Wasser geht nie verloren, es ist immer im Kreislauf.' },
  }),
  q({
    id: 'd5', type: 'bubble_pop', prompt: 'Lass alle Formen von Wasser platzen!',
    payload: { target_rule: 'Ist das eine Form von Wasser?', bubbles: [
      { text: 'Eis', is_correct: true }, { text: 'Wasserdampf', is_correct: true }, { text: 'Regen', is_correct: true },
      { text: 'Sand', is_correct: false }, { text: 'Holz', is_correct: false }, { text: 'Schnee', is_correct: true },
    ] },
  }),
  q({
    id: 'd6', type: 'pair_matching', prompt: 'Verbinde die passenden Paare!',
    payload: { pairs: [
      { left: 'fest', right: 'Eis' }, { left: 'flüssig', right: 'Wasser' }, { left: 'gasförmig', right: 'Wasserdampf' },
    ] },
  }),
  q({
    id: 'd7', type: 'sequencing', prompt: 'Bringe den Wasserkreislauf in die richtige Reihenfolge:',
    payload: { correct_order: ['Wasser verdunstet', 'Wolken entstehen', 'Es regnet', 'Wasser fließt ins Meer'] },
  }),
  q({
    id: 'd8', type: 'multiple_choice', prompt: 'Wie heißt Wasser, das im Boden versickert ist?',
    payload: { options: ['Meerwasser', 'Grundwasser', 'Regenwasser', 'Wolkenwasser'], correct_index: 1,
      explanation: 'Wasser, das in den Boden sickert, heißt Grundwasser.' },
  }),
  q({
    id: 'd9', type: 'word_clicker', prompt: 'Setze das passende Wort ein:',
    payload: { sentence_with_gap: 'Werden die Tropfen zu schwer, fallen sie als [GAP] zur Erde.', correct_word: 'Niederschlag',
      distractors: ['Wasserdampf', 'Nebel', 'Grundwasser'] },
  }),
  q({
    id: 'd10', type: 'pair_matching', prompt: 'Was passiert wo? Verbinde!',
    payload: { pairs: [
      { left: 'Meer', right: 'Wasser verdunstet' }, { left: 'Wolke', right: 'Tröpfchen sammeln sich' },
      { left: 'Boden', right: 'Wasser versickert' },
    ] },
  }),
]
