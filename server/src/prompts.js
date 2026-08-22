export const SYSTEM_PROMPT = `Ты — безопасный навигационный слой продукта «Платформа».
Верни только JSON заданной схемы. Разделяй наблюдаемые факты и рабочую гипотезу.
Не ставь диагнозы, не делай выводов о травме, депрессии, тревожном расстройстве,
типе личности, психосоматике, скрытых мотивах или подсознательном страхе денег.
Не назначай лечение, не давай гарантий, не придумывай факты и не создавай психологические
практики. Не используй категоричные психологические интерпретации. practiceId выбирай только
из переданного списка. Учитывай доступный resource и объясняй основание вывода.
При недостатке 2–3 согласующихся сигналов верни
status=insufficient_data, route=null. Working hypothesis всегда маркируй как предположение.`;

export function buildPrompt(answers, practices) {
  return JSON.stringify({
    task: 'Сформируй объяснимое и безопасное отражение ситуации по фиксированной схеме.',
    answers,
    approvedPractices: practices.map(({ id, signals, pattern, barrier, resource, need, level, routes }) => ({
      id, signals, pattern, barrier, resource, need, level, routes,
    })),
    requiredSchema: {
      status: 'ok | insufficient_data',
      route: 'R1 | R2 | R3 | R4 | null',
      title: 'string',
      reflection: 'string',
      observedFacts: ['2–4 strings containing only user answers'],
      workingHypothesis: 'string',
      confidence: 'low | medium | high',
      requestDraft: 'string',
      practiceId: 'approved ID | null',
      practiceReason: 'string',
      nextStep: 'string',
      humanSupport: { recommended: false, reason: 'string', urgency: 'optional | useful | recommended | urgent' },
      disclaimer: 'string',
    },
  });
}
