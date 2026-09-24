import ExcelJS from 'exceljs';

export const reportSources = [
  { key: 'vip', table: 'restaurant_vip_requests', label: 'VIP dining', columns: 'id,request_series,request_number,booking_reference,full_name,phone,guests,preferred_date,preferred_time,status,created_at,updated_at', ref: 'booking_reference', name: 'full_name' },
  { key: 'rooms', table: 'room_bookings', label: 'Rooms', columns: 'id,request_series,request_number,booking_number,full_name,phone,email,room_type,check_in,check_out,number_of_rooms,status,payment_status,total_price_etb,total_price,created_at,updated_at', ref: 'booking_number', name: 'full_name' },
  { key: 'restaurant', table: 'restaurant_orders', label: 'Restaurant', columns: 'id,request_series,request_number,order_number,customer_name,phone,order_type,items,status,payment_method,payment_status,odoo_status,created_at,updated_at', ref: 'order_number', name: 'customer_name' },
  { key: 'events', table: 'event_hall_bookings', label: 'Events', columns: 'id,request_series,request_number,booking_reference,client_full_name,phone,email,hall_name,event_date,start_time,end_time,attendees,status,payment_status,quoted_amount,quoted_currency,created_at,updated_at', ref: 'booking_reference', name: 'client_full_name' },
  { key: 'tours', table: 'package_bookings', label: 'Tours', columns: 'id,request_series,request_number,package_name,full_name,phone,email,check_in,check_out,guests,message,status,created_at,updated_at', ref: 'id', name: 'full_name' },
  { key: 'tables', table: 'restaurant_requests', label: 'Table enquiries', columns: 'id,request_series,request_number,full_name,phone,email,reservation_date,reservation_time,guests,message,status,created_at,updated_at', ref: 'id', name: 'full_name' },
  { key: 'event_enquiries', table: 'event_requests', label: 'Event enquiries', columns: 'id,request_series,request_number,full_name,phone,email,event_type,event_date,guests,message,status,created_at,updated_at', ref: 'id', name: 'full_name' },
];
export const activityColumns = 'id,service,record_id,reference,customer_name,action,previous_status,status,actor_email,amount,currency,details,created_at';
export const recordedValue = (key, row) => key === 'restaurant' ? (row.items || []).reduce((sum, item) => sum + (Number(item.line_total) || 0), 0) : key === 'rooms' ? Number(row.total_price_etb ?? row.total_price ?? 0) : key === 'events' ? Number(row.quoted_amount || 0) : 0;
export const valueCurrency = (key, row) => key === 'events' ? row.quoted_currency || 'ETB' : 'ETB';
export async function rowsInPeriod(db, table, columns, start, end) {
  const rows = [];
  for (let page = 0; page < 40; page++) {
    const result = await db.from(table).select(columns).gte('created_at', start).lt('created_at', end).order('created_at').order('id').range(page * 500, page * 500 + 499);
    if (result.error) throw result.error;
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
  throw new Error('This report exceeds 20,000 records per service. Choose a shorter period.');
}
export async function collectReport(db, start, end) {
  const entries = await Promise.all(reportSources.map(async source => [source.key, await rowsInPeriod(db, source.table, source.columns, start, end)]));
  const activity = await rowsInPeriod(db, 'admin_activity', activityColumns, start, end);
  const previousStart = new Date(new Date(start).getTime() - (new Date(end) - new Date(start))).toISOString();
  const previous = {};
  await Promise.all(reportSources.map(async source => {
    const result = await db.from(source.table).select('id', { count: 'exact', head: true }).gte('created_at', previousStart).lt('created_at', start);
    if (result.error) throw result.error;
    previous[source.key] = result.count || 0;
  }));
  return { start, end, generatedAt: new Date().toISOString(), previousStart, previous, records: Object.fromEntries(entries), activity };
}
export function summarizeReport(data) {
  const services = reportSources.map(source => {
    const rows = data.records[source.key] || [];
    const statuses = {}, values = {};
    for (const row of rows) {
      statuses[row.status || 'unknown'] = (statuses[row.status || 'unknown'] || 0) + 1;
      if (['rooms', 'restaurant', 'events'].includes(source.key)) {
        const currency = valueCurrency(source.key, row);
        values[currency] = (values[currency] || 0) + recordedValue(source.key, row);
      }
    }
    return { service: source.label, count: rows.length, previous: data.previous?.[source.key] || 0, statuses, values };
  });
  const approvals = data.activity.filter(row => ['approved', 'confirmed', 'approved_awaiting_payment'].includes(row.action)).length;
  const declines = data.activity.filter(row => ['declined', 'rejected'].includes(row.action)).length;
  const lines = services.map(row => `${row.service}: ${row.count} new records (${row.count - row.previous >= 0 ? '+' : ''}${row.count - row.previous} versus the preceding period of equal length).`);
  lines.push(`${approvals} approval/confirmation actions and ${declines} decline/rejection actions recorded during this period.`);
  lines.push('Recorded values include submitted requests and quotes; they are not a collected-revenue or profit figure. Record statuses reflect the latest state when the report was generated. Activity history starts when Master Admin was enabled.');
  return { services, approvals, declines, lines };
}
const dateCell = value => value ? new Date(new Date(value).getTime() + 3 * 60 * 60 * 1000) : null;
export async function buildWorkbook(data, summary = summarizeReport(data)) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Harla Hotel'; workbook.created = new Date(data.generatedAt);
  function sheet(name, columns, rows) {
    const page = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }], properties: { defaultRowHeight: 22 } });
    page.columns = columns.map(([header, key, width = 22, numFmt]) => ({ header, key, width, style: numFmt ? { numFmt } : {} }));
    for (const row of rows) page.addRow(row);
    page.getRow(1).font = { bold: true, color: { argb: 'FFF0D497' } };
    page.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF161512' } };
    page.getRow(1).height = 28;
    page.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    page.eachRow((row, index) => { if (index > 1 && index % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F4ED' } }; row.alignment = { vertical: 'top', wrapText: true }; });
    return page;
  }
  const overview = sheet('Summary', [['Measure', 'measure', 34], ['Details', 'details', 110]], [
    { measure: 'Harla Hotel management report', details: 'All dates and times below use Ethiopia time (UTC+03:00).' },
    { measure: 'Period starts (inclusive)', details: dateCell(data.start) },
    { measure: 'Period ends (exclusive)', details: dateCell(data.end) },
    { measure: 'Generated', details: dateCell(data.generatedAt) },
    ...summary.lines.map((details, index) => ({ measure: index < reportSources.length ? 'New records and comparison' : 'Activity / interpretation', details })),
    ...summary.services.flatMap(service => [
      ...Object.entries(service.statuses).map(([status, count]) => ({ measure: `${service.service}: ${status}`, details: count })),
      ...Object.entries(service.values).map(([currency, amount]) => ({ measure: `${service.service}: recorded value (${currency})`, details: amount })),
    ]),
  ]);
  for (const row of [3, 4, 5]) overview.getCell(row, 2).numFmt = 'yyyy-mm-dd hh:mm';
  overview.eachRow(row => { row.height = 36; });
  for (const source of reportSources) {
    const columns = [['Reference', 'reference', 35], ['Customer', 'customer', 25], ['Phone', 'phone', 22], ['Email', 'email', 30], ['Created (Ethiopia)', 'created', 24, 'yyyy-mm-dd hh:mm'], ['Status (at generation)', 'status', 28]];
    if (['rooms', 'restaurant', 'events'].includes(source.key)) columns.push(['Payment status', 'payment_status', 25], ['Recorded value', 'amount', 20, '#,##0.00'], ['Currency', 'currency', 12]);
    columns.push(['Request number', 'request_number', 18], ['Numbering series', 'request_series', 18], ['Service details', 'details', 60]);
    sheet(source.label, columns, (data.records[source.key] || []).map(row => ({
      request_number: row.request_number, request_series: row.request_series, reference: row[source.ref], customer: row[source.name], phone: row.phone, email: row.email,
      created: dateCell(row.created_at), status: row.status, payment_status: row.payment_status,
      amount: recordedValue(source.key, row), currency: valueCurrency(source.key, row),
      details: source.key === 'restaurant' ? `${row.order_type}; kitchen: ${row.odoo_status === 'entered' ? 'sent' : 'not sent'}; ${(row.items || []).map(item => `${item.quantity} × ${item.name}`).join(', ')}`
        : source.key === 'rooms' ? `${row.room_type}; ${row.check_in} to ${row.check_out}; ${row.number_of_rooms || 1} room(s)`
        : source.key === 'events' ? `${row.hall_name}; ${row.event_date} ${row.start_time}–${row.end_time}; ${row.attendees} attendees`
        : source.key === 'vip' ? `${row.guests ?? 'Unspecified'} people; ${row.preferred_date || 'date to discuss'}; ${row.preferred_time || 'time to discuss'} (Ethiopia)`
        : [row.package_name, row.event_type, row.reservation_date, row.reservation_time, row.check_in, row.check_out, row.message].filter(Boolean).join('; '),
    })));
  }
  sheet('Activity', [['Time (Ethiopia)', 'time', 24, 'yyyy-mm-dd hh:mm'], ['Service', 'service', 22], ['Reference', 'reference', 35], ['Customer', 'customer_name', 25], ['Action', 'action', 26], ['Previous status', 'previous_status', 26], ['New status', 'status', 26], ['Staff email', 'actor', 32], ['Changes', 'changes', 60]],
    data.activity.map(row => ({ ...row, time: dateCell(row.created_at), actor: row.actor_email || 'Customer / automated system', changes: JSON.stringify(row.details || {}) })));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
export const reportMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
