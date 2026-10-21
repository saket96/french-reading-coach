# Regenerates docs/privacy.html (GitHub Pages) from PRIVACY.md. Run after editing PRIVACY.md.
import html, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(https?://[^\s<)]+)", r'<a href="\1">\1</a>', t)
    return re.sub(r"([\w.+-]+@[\w-]+\.[\w.]+)", r'<a href="mailto:\1">\1</a>', t)

def md_to_html(md):
    out, para, in_list = [], [], False
    def flush():
        nonlocal para
        if para:
            out.append("<p>" + "<br>".join(inline(x) for x in para) + "</p>")
            para = []
    for line in md.splitlines():
        s = line.strip()
        m = re.match(r"^(#{1,3})\s+(.*)", s)
        if m or s.startswith("- ") or not s:
            flush()
        if in_list and not s.startswith("- "):
            out.append("</ul>"); in_list = False
        if m:
            n = len(m.group(1)); out.append(f"<h{n}>{inline(m.group(2))}</h{n}>")
        elif s.startswith("- "):
            if not in_list: out.append("<ul>"); in_list = True
            out.append("<li>" + inline(s[2:]) + "</li>")
        elif s:
            para.append(s)
    flush()
    if in_list: out.append("</ul>")
    return "\n".join(out)

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><link rel="icon" href="icon128.png">
<style>
:root{{--bg:#fff;--fg:#1A1D29;--muted:#5B6275;--line:#E5E7EB;--accent:#3B5BDB;--code:#F3F4F8}}
@media (prefers-color-scheme:dark){{:root{{--bg:#131419;--fg:#ECEDEF;--muted:#9AA0AA;--line:#2A2C33;--accent:#8FA6F5;--code:#1E2027}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif}}
main{{max-width:720px;margin:0 auto;padding:48px 20px 80px}}
header{{display:flex;align-items:center;gap:12px;margin-bottom:24px}} header img{{width:40px;height:40px}}
h1{{font-size:28px;line-height:1.25;margin:0}} h2{{font-size:19px;margin:32px 0 8px;padding-top:16px;border-top:1px solid var(--line)}}
a{{color:var(--accent)}} code{{background:var(--code);padding:1px 5px;border-radius:4px;font-size:.9em}}
li{{margin:6px 0}} p,li{{color:var(--fg)}} .muted{{color:var(--muted)}}
</style></head><body><main>{body}</main></body></html>
"""

def main():
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    body = md_to_html(open(os.path.join(ROOT, "PRIVACY.md"), encoding="utf-8").read())
    body = body.replace("<h1>", '<header><img src="icon128.png" alt=""><h1>', 1).replace("</h1>", "</h1></header>", 1)
    open(os.path.join(ROOT, "docs", "privacy.html"), "w", encoding="utf-8").write(PAGE.format(title="DualCoach Privacy Policy", body=body))
    index = ('<header><img src="icon128.png" alt=""><h1>DualCoach</h1></header>'
             "<p>Dual subtitles for language learners. Free Chrome extension for Netflix and YouTube: "
             "see two subtitle tracks at once and click any word for its meaning.</p>"
             '<p><a href="privacy.html">Privacy policy</a> · <a href="https://saketsuman.com/contact/">Contact</a></p>'
             '<p class="muted">Not affiliated with Netflix or YouTube.</p>')
    open(os.path.join(ROOT, "docs", "index.html"), "w", encoding="utf-8").write(PAGE.format(title="DualCoach", body=index))
    import shutil
    shutil.copyfile(os.path.join(ROOT, "icons", "icon128.png"), os.path.join(ROOT, "docs", "icon128.png"))
    print("docs/ written")

main()
