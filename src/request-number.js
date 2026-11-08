export function requestNumberLabel(record) {
  return Number.isSafeInteger(Number(record.request_number)) && Number(record.request_number) > 0
    ? `Request #${record.request_number} · Series ${record.request_series}`
    : 'Earlier record';
}
