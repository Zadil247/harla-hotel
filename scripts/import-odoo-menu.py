#!/usr/bin/env python3
"""Extract only restaurant menu data/images from an Odoo ZIP, without executing SQL."""
import argparse, collections, hashlib, html, json, pathlib, re, zipfile
from decimal import Decimal, ROUND_HALF_UP

TABLES = {'product_template', 'pos_category', 'pos_category_product_template_rel',
          'pos_category_pos_config_rel', 'pos_config', 'res_company', 'res_currency',
          'product_taxes_rel', 'account_tax', 'ir_attachment'}

def decode_copy(value):
    if value == r'\N': return None
    return re.sub(r'\\([0-7]{1,3}|.)', lambda m: chr(int(m[1], 8)) if m[1].isdigit()
                  else {'t':'\t','n':'\n','r':'\r','b':'\b','f':'\f','v':'\v','\\':'\\'}.get(m[1], m[1]), value)

def label(value):
    if not value: return ''
    try:
        obj = json.loads(value)
        if isinstance(obj, dict): value = obj.get('en_US') or next(iter(obj.values()), '')
    except json.JSONDecodeError: pass
    return html.unescape(re.sub('<[^>]*>', '', value)).strip()

def extract(archive, output):
    data = collections.defaultdict(list)
    with zipfile.ZipFile(archive) as z:
        table = None
        for raw in z.open('dump.sql'):
            line = raw.decode('utf-8').rstrip('\n')
            if line.startswith('COPY public.'):
                match = re.fullmatch(r'COPY public\.(\w+) \((.+)\) FROM stdin;', line)
                table = match[1] if match and match[1] in TABLES else None
                if table: columns = [c.strip('"') for c in match[2].split(', ')]
            elif line == r'\.': table = None
            elif table:
                values = [decode_copy(v) for v in line.split('\t')]
                if len(columns) != len(values): raise ValueError('Invalid COPY row')
                data[table].append(dict(zip(columns, values)))
        config = next(r for r in data['pos_config'] if r['name'] == 'Harla Restaurant')
        company = next(r for r in data['res_company'] if r['id'] == config['company_id'])
        currency = next(r for r in data['res_currency'] if r['id'] == config['currency_id'])
        if currency['name'] != 'ETB': raise ValueError('Expected ETB catalogue')
        allowed = {r['pos_category_id'] for r in data['pos_category_pos_config_rel'] if r['pos_config_id'] == config['id']}
        categories = {r['id']: r for r in data['pos_category'] if r['id'] in allowed}
        relations = collections.defaultdict(list)
        for r in data['pos_category_product_template_rel']:
            if r['pos_category_id'] in allowed: relations[r['product_template_id']].append(r['pos_category_id'])
        tax_map = {r['id']: r for r in data['account_tax'] if r['company_id'] == config['company_id']}
        product_taxes = collections.defaultdict(list)
        for r in data['product_taxes_rel']:
            if r['tax_id'] in tax_map: product_taxes[r['prod_id']].append(tax_map[r['tax_id']])
        attachments = {}
        for r in data['ir_attachment']:
            if r['res_model'] == 'product.template' and r['res_field'] == 'image_512': attachments[r['res_id']] = r
        items, merged, seen = [], [], {}
        for r in sorted(data['product_template'], key=lambda r: int(r['id']), reverse=True):
            if not all(r[k] == 't' for k in ('active', 'sale_ok', 'available_in_pos')): continue
            if not relations[r['id']] or r['company_id'] not in (None, config['company_id']): continue
            base = Decimal(r['list_price']); gross = base
            for tax in product_taxes[r['id']]:
                if tax['amount_type'] != 'percent' or tax['include_base_amount'] == 't': raise ValueError('Unsupported tax computation')
                included = (tax['price_include_override'] or company['account_price_include']) == 'tax_included'
                if not included: gross += base * Decimal(tax['amount']) / 100
            price = gross.quantize(Decimal(1).scaleb(-int(currency['decimal_places'])), rounding=ROUND_HALF_UP)
            if price <= 0: raise ValueError('Nonpositive menu price')
            category = categories[relations[r['id']][0]]
            name = label(r['name'])
            key = (name.casefold(), category['id'], str(price))
            if key in seen:
                merged.append({'name':name,'kept':seen[key], 'duplicate':int(r['id'])}); continue
            seen[key] = int(r['id'])
            item = {'id':f"odoo-{r['id']}", 'name':name, 'category':label(category['name']),
                    'categoryOrder':int(category['sequence'] or 0), 'price':float(price),
                    'description':label(r['description_sale']), 'image':''}
            attachment = attachments.get(r['id'])
            if attachment and attachment['store_fname']:
                extension = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}.get(attachment['mimetype'])
                if extension and re.fullmatch('[0-9a-f]{2}/[0-9a-f]{40}', attachment['store_fname']):
                    relative = pathlib.Path('assets/restaurant-menu') / f"{item['id']}.{extension}"
                    destination = output / relative; destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(z.read('filestore/' + attachment['store_fname']))
                    item['image'] = '/' + relative.as_posix()
            items.append(item)
        items.sort(key=lambda r:(r['categoryOrder'],r['category'],r['name'].casefold()))
        for item in items: del item['categoryOrder']
        target = output / 'src/restaurant-menu-data.js'; target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text('// Generated by scripts/import-odoo-menu.py. Public menu data only.\n'
                          '// ETB customer prices include the taxes configured for Harla Restaurant.\n'
                          'export const restaurantMenuItems = '+json.dumps(items,ensure_ascii=False,indent=2)+';\n')
        summary = {'items':len(items),'categories':dict(collections.Counter(r['category'] for r in items)),
                   'images':sum(bool(r['image']) for r in items),'mergedDuplicates':merged,
                   'archiveSha256':hashlib.sha256(pathlib.Path(archive).read_bytes()).hexdigest(),
                   'priceBasis':'Restaurant company tax rules; gross price rounded to ETB 0.01 per menu unit.'}
        print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('archive');parser.add_argument('--output',default='.')
    args=parser.parse_args();extract(args.archive,pathlib.Path(args.output))
