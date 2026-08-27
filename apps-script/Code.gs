const SPREADSHEET_ID = '1YXlOZpuBbeyU7c5qrvJ0hAIs9bbrhY651qvN7cuEGhU';
const JOURNEYS_SHEET = 'Прохождения';
const EVENTS_SHEET = 'События';
const V3_EXTRA_HEADERS = ['startedAt', 'completedAt', 'profileOpened', 'whatsappClicked'];
const EVENT_HEADERS = ['timestamp', 'sessionId', 'event', 'page', 'source', 'testEvent'];

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = spreadsheet.getSheetByName(JOURNEYS_SHEET);
    if (!sheet) throw new Error('JOURNEYS_SHEET_MISSING');
    ensureJourneyHeaders(sheet);

    if (data.schemaVersion === 'v3') {
      return jsonResponse(upsertV3Journey(spreadsheet, sheet, data));
    }

    const row = legacyRow(data);
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return jsonResponse({ success: true, sessionId: row[1] });
  } catch (error) {
    return jsonResponse({ success: false, error: 'WRITE_FAILED' });
  } finally {
    lock.releaseLock();
  }
}

function upsertV3Journey(spreadsheet, sheet, data) {
  const event = String(data.event || data.status || '');
  const sessionId = String(data.sessionId || '').trim();
  if (!sessionId) return { success: false, error: 'INVALID_SESSION' };

  if (!['feedback_submitted', 'profile_opened', 'whatsapp_clicked'].includes(event)) {
    appendTechnicalEvent(spreadsheet, data);
    return { success: true, sessionId: sessionId, destination: EVENTS_SHEET };
  }

  const existingRow = findJourneyRow(sheet, sessionId);
  const rowNumber = existingRow || Math.max(sheet.getLastRow() + 1, 2);
  const previous = existingRow
    ? sheet.getRange(existingRow, 1, 1, 44).getValues()[0]
    : new Array(44).fill('');
  const next = event === 'feedback_submitted'
    ? feedbackRow(data, previous)
    : meaningfulEventRow(data, previous, event);
  sheet.getRange(rowNumber, 1, 1, 44).setValues([next]);
  SpreadsheetApp.flush();
  return { success: true, sessionId: sessionId, row: rowNumber, operation: existingRow ? 'updated' : 'created' };
}

function feedbackRow(data, previous) {
  const openTextConsent = data.openTextConsent === true;
  const row = legacyRow(data).concat([
    data.resultStatus || '',
    data.route || '',
    data.practice || '',
    data.reflectionScore || '',
    data.explanationScore || '',
    data.clarityScore || '',
    data.stepRealism || '',
    data.trustScore || '',
    data.recognition || '',
    data.repetition || '',
    data.bookingReadiness || '',
    data.source || 'AI-навигатор',
    data.timestamp || '',
    data.testEvent === true ? 'TRUE' : 'FALSE',
    openTextConsent ? 'TRUE' : 'FALSE',
    openTextConsent ? (data.openConcern || '') : '',
    openTextConsent ? (data.openFeedback || '') : '',
    data.startedAt || previous[40] || '',
    data.completedAt || data.timestamp || previous[41] || '',
    previous[42] || (data.profileOpened === true ? 'TRUE' : 'FALSE'),
    previous[43] || (data.whatsappClicked === true ? 'TRUE' : 'FALSE'),
  ]);
  row[2] = 'завершено';
  return row;
}

function meaningfulEventRow(data, previous, event) {
  const row = previous.slice();
  while (row.length < 44) row.push('');
  row[0] = row[0] || Utilities.formatDate(new Date(), 'Asia/Qyzylorda', 'yyyy-MM-dd HH:mm:ss');
  row[1] = data.sessionId;
  row[2] = row[2] || 'значимое прохождение';
  row[22] = row[22] || data.source || 'AI-навигатор';
  row[35] = data.timestamp || row[35] || '';
  row[36] = data.testEvent === true ? 'TRUE' : (row[36] || 'FALSE');
  row[40] = data.startedAt || row[40] || '';
  if (event === 'profile_opened') row[42] = 'TRUE';
  if (event === 'whatsapp_clicked') row[43] = 'TRUE';
  return row;
}

function legacyRow(data) {
  const openTextConsent = data.openTextConsent === true;
  const isV3Payload = Object.prototype.hasOwnProperty.call(data, 'resultStatus');
  const legacyMainConcern = isV3Payload && !openTextConsent ? '' : (data.mainConcern || '');
  return [
    Utilities.formatDate(new Date(), 'Asia/Qyzylorda', 'yyyy-MM-dd HH:mm:ss'),
    data.sessionId || Utilities.getUuid(),
    data.status || 'завершено',
    data.mainSituation || '',
    legacyMainConcern,
    data.duration || '',
    data.lifeImpact || '',
    data.triedBefore || '',
    data.desiredResult || '',
    data.currentNeed || '',
    data.resourceLevel || '',
    data.safetyLevel || '',
    data.route || '',
    data.practice || '',
    data.clarityScore || '',
    data.trustScore || '',
    data.bookingReadiness || '',
    data.bookingClicked === true ? 'TRUE' : 'FALSE',
    data.comment || '',
    data.name || '',
    data.contact || '',
    data.consent === true ? 'TRUE' : 'FALSE',
    data.source || 'AI-навигатор',
  ];
}

function findJourneyRow(sheet, sessionId) {
  if (sheet.getLastRow() < 2) return 0;
  const match = sheet.getRange(2, 2, sheet.getLastRow() - 1, 1)
    .createTextFinder(sessionId)
    .matchEntireCell(true)
    .findNext();
  return match ? match.getRow() : 0;
}

function appendTechnicalEvent(spreadsheet, data) {
  let sheet = spreadsheet.getSheetByName(EVENTS_SHEET);
  if (!sheet) sheet = spreadsheet.insertSheet(EVENTS_SHEET);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, EVENT_HEADERS.length).setValues([EVENT_HEADERS]);
  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    data.sessionId || '',
    data.event || data.status || '',
    data.page || '',
    data.source || '',
    data.testEvent === true ? 'TRUE' : 'FALSE',
  ]);
}

function ensureJourneyHeaders(sheet) {
  sheet.getRange(1, 41, 1, V3_EXTRA_HEADERS.length).setValues([V3_EXTRA_HEADERS]);
}

function doGet() {
  return jsonResponse({ success: true, message: 'Сбор результатов MVP работает' });
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

