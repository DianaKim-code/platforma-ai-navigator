function section(title, content, className = '') {
  const element = document.createElement('section');
  element.className = `result-section ${className}`.trim();
  const heading = document.createElement('h3');
  heading.textContent = title;
  element.appendChild(heading);
  if (Array.isArray(content)) {
    const list = document.createElement('ul');
    content.forEach((value) => {
      const item = document.createElement('li');
      item.textContent = value;
      list.appendChild(item);
    });
    element.appendChild(list);
  } else {
    const paragraph = document.createElement('p');
    paragraph.textContent = content;
    element.appendChild(paragraph);
  }
  return element;
}

export function renderAiResult(root, titleElement, result, practice) {
  root.replaceChildren();
  titleElement.textContent = result.title;
  root.appendChild(section('Что сейчас видно', result.reflection));
  root.appendChild(section('Почему навигатор пришёл к этому выводу', result.rationale, 'rationale-section'));
  const hypothesis = section('Рабочая гипотеза', result.workingHypothesis, 'hypothesis-section');
  const marker = document.createElement('p');
  marker.className = 'hypothesis-marker';
  marker.textContent = 'Это рабочее предположение, а не диагноз.';
  hypothesis.appendChild(marker);
  root.appendChild(hypothesis);
  root.appendChild(section('Как можно сформулировать запрос', result.requestDraft));

  const step = section('Первый шаг', result.nextStep, 'first-step-section');
  if (practice) {
    const details = document.createElement('details');
    details.id = 'practiceDetails';
    const summary = document.createElement('summary');
    summary.textContent = 'Открыть выбранную практику';
    const metadata = document.createElement('p');
    metadata.className = 'practice-meta';
    metadata.textContent = `Уровень: ${practice.level} · Длительность: ${practice.duration}`;
    const practiceText = document.createElement('p');
    practiceText.textContent = practice.text;
    const reason = document.createElement('p');
    reason.className = 'hypothesis-marker';
    reason.textContent = result.practiceReason;
    details.append(summary, metadata, practiceText, reason);
    step.appendChild(details);
  }
  root.appendChild(step);
  root.appendChild(section('Когда может быть полезен человек', result.humanSupport.reason));
}

export function loadingMessage(stage = 0) {
  return [
    'Собираю ваши ответы…',
    'Сопоставляю важные сигналы…',
    'Формирую следующий шаг…',
  ][stage % 3];
}
