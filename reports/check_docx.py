from zipfile import ZipFile
from pathlib import Path
p = Path('reports/TaxiFlow_Troubleshooting_Report_2026-05-19.docx')
with ZipFile(p) as z:
    names = set(z.namelist())
    required = {'[Content_Types].xml', 'word/document.xml', 'word/styles.xml'}
    missing = required - names
    text = z.read('word/document.xml').decode('utf-8', errors='ignore')
print({
    'exists': p.exists(),
    'size': p.stat().st_size,
    'missing_required_parts': sorted(missing),
    'contains_title': 'TaxiFlow Pro Troubleshooting Report' in text,
    'contains_access_fix': 'Admin and Manager users can now access operational modules' in text,
})
