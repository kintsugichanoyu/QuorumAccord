"""Export the evidence deck to PowerPoint. Requires python-pptx (optional)."""
from pathlib import Path
from html.parser import HTMLParser
import json
import re
from html import unescape
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.oxml.xmlchemy import OxmlElement

OUT = Path(__file__).parent / 'evidence' / 'latest'
slides = json.loads((OUT / 'slides.json').read_text())
outcome = json.loads((OUT / 'outcome.json').read_text())
transactions = json.loads((OUT / 'transactions.json').read_text())
snapshots = json.loads((OUT / 'snapshots.json').read_text())['snapshots']

class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag in ('p', 'pre', 'div', 'tr', 'details', 'br'): self.parts.append('\n')
    def handle_data(self, data): self.parts.append(data)
    def handle_endtag(self, tag):
        if tag in ('td', 'th'): self.parts.append('  |  ')
        if tag in ('p', 'pre', 'tr', 'details'): self.parts.append('\n')
    def text(self):
        return '\n'.join(line.strip() for line in ''.join(self.parts).splitlines() if line.strip())

prs = Presentation(); prs.slide_width = Inches(16); prs.slide_height = Inches(9)
BG, INK, MINT, MUTED = ['07121C', 'EAF6F5', '6DE8BF', '91ABB4']
def box(slide, x, y, w, h, text, size, color, font='Aptos'):
    shape = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    frame = shape.text_frame; frame.word_wrap = True
    for i, line in enumerate(text.splitlines()):
        p = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
        p.text = line; p.font.name = font; p.font.size = Pt(size); p.font.color.rgb = RGBColor.from_string(color)
        p.space_after = Pt(7)
    return shape
for i, data in enumerate(slides):
    slide = prs.slides.add_slide(prs.slide_layouts[6]); slide.background.fill.solid(); slide.background.fill.fore_color.rgb = RGBColor.from_string(BG)
    box(slide, .8, .5, 14, .4, data['kicker'], 12, MINT)
    box(slide, .8, 1.2, 14, 1.3, data['title'], 38, INK)
    def compact(match):
        raw = unescape(match.group(1))
        try: raw = json.dumps(json.loads(raw), separators=(',', ':'))
        except json.JSONDecodeError: pass
        return '<pre>' + raw + '</pre>'
    parser = Text(); parser.feed(re.sub(r'<pre>(.*?)</pre>', compact, data['html'], flags=re.S)); text = parser.text()
    size = 17 if len(text) < 1000 else 13 if len(text) < 2300 else 10
    box(slide, .8, 2.6, 14.3, 5.65, text, size, INK, 'Aptos' if i not in (8, 11) else 'Consolas')
    if i == 11:
        chart_data = CategoryChartData()
        chart_data.categories = [s['at'][11:19] for s in snapshots]
        for n, venue in enumerate(outcome['config']['feeds']):
            chart_data.add_series(venue['name'], [s['accounts'][0]['decoded']['weights'][n] / 100 for s in snapshots])
        chart = slide.shapes.add_chart(XL_CHART_TYPE.LINE, Inches(.9), Inches(4.5), Inches(14), Inches(3.3), chart_data).chart
        chart.has_legend = True; chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.font.size = Pt(11); chart.legend.font.color.rgb = RGBColor.from_string(INK)
        chart.chart_style = 13
        sp = OxmlElement('c:spPr'); fill = OxmlElement('a:solidFill'); color = OxmlElement('a:srgbClr'); color.set('val', BG)
        fill.append(color); sp.append(fill)
        chart._chartSpace.insert_element_before(sp, 'c:txPr', 'c:externalData', 'c:printSettings', 'c:userShapes', 'c:extLst')
        chart.value_axis.minimum_scale = 0; chart.value_axis.maximum_scale = 100
        chart.value_axis.tick_labels.font.size = Pt(10); chart.value_axis.tick_labels.font.color.rgb = RGBColor.from_string(MUTED)
        chart.category_axis.tick_labels.font.size = Pt(9); chart.category_axis.tick_labels.font.color.rgb = RGBColor.from_string(MUTED)
        for series, color in zip(chart.series, [MINT, 'F2C779', '8DB6FF']):
            series.format.line.color.rgb = RGBColor.from_string(color); series.format.line.width = Pt(2)
    box(slide, .8, 8.55, 14, .3, f'QUORUM · DEVNET EVIDENCE · {outcome["finished_at"][:10]}                         {i+1:02} / {len(slides)}', 9, MUTED)
    slide.notes_slide.notes_text_frame.text = '\n'.join(data['notes'])
    # All transaction hashes retain clickable Explorer hyperlinks.
    for shape in slide.shapes:
        if not shape.has_text_frame: continue
        for p in shape.text_frame.paragraphs:
            for run in p.runs:
                for tx in transactions:
                    if tx['signature'] in run.text:
                        run.hyperlink.address = f'https://explorer.solana.com/tx/{tx["signature"]}?cluster=devnet'
prs.save(OUT / 'presentation.pptx')
print(f'Wrote {len(slides)} slides to {OUT / "presentation.pptx"}')
