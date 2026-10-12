/**
 * Code editor for the AI interview's coding / pseudo-code questions (12 Oct 2026).
 *
 * No library, no CDN: a <textarea> the candidate types into, laid exactly over a
 * <pre> that shows the same text with syntax colours, plus a line-number
 * gutter. The textarea keeps every native behaviour (caret, selection, IME,
 * undo); only its text is made transparent.
 *
 *  - LANGUAGES / languageLabel(key)       the languages a question may allow
 *  - starterFor(lang, starters)            the question's starter, else a boilerplate
 *  - highlight(code, lang)                 PURE: escaped HTML with token spans
 *  - createCodeEditor(opts)                the editor (returns a small controller)
 *  - renderCodeBlock(code, lang)           read-only block with line numbers (pseudo-code)
 *
 * The textarea carries `data-kx-code-editor`: interview_security.js lets typing
 * through inside it. Copy / paste / drop are refused here, quietly.
 */

export const LANGUAGES = [
  { key: "c", label: "C" },
  { key: "embedded_c", label: "Embedded C" },
  { key: "cpp", label: "C++" },
  { key: "java", label: "Java" },
  { key: "kotlin", label: "Kotlin (Android)" },
  { key: "python", label: "Python" },
  { key: "javascript", label: "JavaScript" },
  { key: "typescript", label: "TypeScript" },
  { key: "csharp", label: "C#" },
  { key: "go", label: "Go" },
  { key: "rust", label: "Rust" },
  { key: "swift", label: "Swift" },
  { key: "sql", label: "SQL" },
  { key: "shell", label: "Shell / Bash" },
  { key: "capl", label: "CAPL (CANoe)" },
  { key: "matlab", label: "MATLAB" },
  { key: "asm", label: "Assembly" },
];
const LABELS = Object.fromEntries(LANGUAGES.map((l) => [l.key, l.label]));
LABELS.pseudo = "Pseudo-code";
LABELS.any = "Any language";

export function languageLabel(key) {
  return LABELS[String(key || "").toLowerCase()] || String(key || "");
}

const BOILERPLATE = {
  c: "#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n",
  embedded_c: "#include <stdint.h>\n\n/* Write your function here */\nvoid solution(void)\n{\n    \n}\n",
  cpp: "#include <iostream>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n",
  java: "public class Solution {\n    public static void main(String[] args) {\n        \n    }\n}\n",
  kotlin: "fun main() {\n    \n}\n",
  python: "def solution():\n    pass\n",
  javascript: "function solution() {\n  \n}\n",
  typescript: "function solution(): void {\n  \n}\n",
  csharp: "using System;\n\npublic class Solution\n{\n    public static void Main()\n    {\n        \n    }\n}\n",
  go: "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println()\n}\n",
  rust: "fn main() {\n    \n}\n",
  swift: "func solution() {\n    \n}\n",
  sql: "-- Write your query\nSELECT\n",
  shell: "#!/bin/bash\n\n",
  capl: "variables\n{\n}\n\non start\n{\n  \n}\n",
  matlab: "function result = solution()\n    \nend\n",
  asm: "; Write your routine\n",
};

/** The question's own starter for `lang`, else a small boilerplate, else "". */
export function starterFor(lang, starters, fallbackCode) {
  const k = String(lang || "").toLowerCase();
  if (starters && typeof starters === "object" && starters[k]) return String(starters[k]);
  if (fallbackCode) return String(fallbackCode);
  return BOILERPLATE[k] || "";
}

/* ------------------------------------------------------------------------- */
/* Highlighter                                                               */
/* ------------------------------------------------------------------------- */

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

const C_KW = "auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while";
const C_TY = "void char short int long float double signed unsigned bool _Bool size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t uintptr_t FILE";
const C_LIT = "NULL true false TRUE FALSE";

const DEFS = {
  c: { kw: words(C_KW), ty: words(C_TY), lit: words(C_LIT), line: "//", block: ["/*", "*/"], quotes: "\"'", hash: true },
  embedded_c: {
    kw: words(`${C_KW} __interrupt interrupt __asm asm __attribute__ __weak __packed ISR`),
    ty: words(`${C_TY} uint8 uint16 uint32 uint64 sint8 sint16 sint32 boolean Std_ReturnType BaseType_t TickType_t TaskHandle_t QueueHandle_t SemaphoreHandle_t`),
    lit: words(`${C_LIT} E_OK E_NOT_OK STD_ON STD_OFF pdTRUE pdFALSE portMAX_DELAY`),
    line: "//", block: ["/*", "*/"], quotes: "\"'", hash: true,
  },
  cpp: {
    kw: words(`${C_KW} class namespace template typename public private protected virtual override final new delete this using try catch throw constexpr explicit friend operator noexcept static_cast dynamic_cast reinterpret_cast const_cast decltype mutable`),
    ty: words(`${C_TY} string vector map unordered_map set array unique_ptr shared_ptr std auto`),
    lit: words("nullptr true false NULL"), line: "//", block: ["/*", "*/"], quotes: "\"'", hash: true,
  },
  java: {
    kw: words("abstract assert break case catch class continue default do else enum extends final finally for if implements import instanceof interface native new package private protected public return static super switch synchronized this throw throws transient try volatile while var record"),
    ty: words("boolean byte char short int long float double void String Integer Long Double Boolean List Map Set ArrayList HashMap HashSet Object StringBuilder"),
    lit: words("true false null"), line: "//", block: ["/*", "*/"], quotes: "\"'", at: true,
  },
  kotlin: {
    kw: words("fun val var class object interface data sealed open override private public internal protected companion if else when for while do return break continue in is as try catch finally throw import package suspend lateinit init by typealias enum this super"),
    ty: words("Int Long Short Byte String Boolean Double Float Char Unit Any List MutableList Map MutableMap Set Array ArrayList"),
    lit: words("true false null"), line: "//", block: ["/*", "*/"], quotes: "\"'", at: true,
  },
  python: {
    kw: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield"),
    ty: words("int str float bool list dict set tuple bytes object"),
    lit: words("None True False self cls"), builtin: words("print len range enumerate zip map filter sorted sum min max open isinstance abs any all reversed input"),
    line: "#", quotes: "\"'", triple: true, at: true,
  },
  javascript: {
    kw: words("async await break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return static super switch this throw try typeof var void while yield"),
    ty: words("Array Object String Number Boolean Map Set Promise Math JSON console"),
    lit: words("true false null undefined NaN"), line: "//", block: ["/*", "*/"], quotes: "\"'`",
  },
  csharp: {
    kw: words("abstract as base break case catch class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out override params private protected public readonly ref return sealed sizeof static struct switch this throw try typeof unchecked unsafe using virtual volatile while var async await"),
    ty: words("bool byte char decimal double float int long object sbyte short string uint ulong ushort void List Dictionary Console"),
    lit: words("true false null"), line: "//", block: ["/*", "*/"], quotes: "\"'", hash: true,
  },
  go: {
    kw: words("break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var"),
    ty: words("bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr"),
    lit: words("true false nil iota"), builtin: words("append cap close copy delete len make new panic print println recover fmt"),
    line: "//", block: ["/*", "*/"], quotes: "\"'`",
  },
  rust: {
    kw: words("as async await break const continue crate else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while dyn"),
    ty: words("i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box HashMap"),
    lit: words("true false None Some Ok Err"), line: "//", block: ["/*", "*/"], quotes: "\"",
  },
  swift: {
    kw: words("class deinit enum extension func import init inout let operator private protocol public static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch is rethrows throw throws try self Self"),
    ty: words("Int Double Float String Bool Character Array Dictionary Set Optional Any"),
    lit: words("true false nil"), line: "//", block: ["/*", "*/"], quotes: "\"", at: true,
  },
  sql: {
    kw: words("select from where and or not in is null as join inner left right full outer on group by order having limit offset insert into values update set delete create table alter drop index primary key foreign references distinct union all case when then else end exists between like count sum avg min max with desc asc"),
    ty: words("int integer varchar char text date datetime timestamp decimal numeric float boolean bigint"),
    lit: words("true false null"), line: "--", block: ["/*", "*/"], quotes: "'\"", nocase: true,
  },
  shell: {
    kw: words("if then else elif fi for while until do done case esac function return in local export readonly select break continue exit shift source"),
    ty: words(""), lit: words("true false"), builtin: words("echo printf read cd ls grep sed awk cat test"),
    line: "#", quotes: "\"'", dollar: true,
  },
  capl: {
    kw: words(`${C_KW} on message timer msTimer variables includes start preStart stopMeasurement key signal envVar errorFrame this testcase`),
    ty: words(`${C_TY} byte word dword qword message timer msTimer`),
    lit: words(C_LIT),
    builtin: words("output write setTimer cancelTimer getValue putValue testWaitForTimeout getSignal setSignal timeNow elcount"),
    line: "//", block: ["/*", "*/"], quotes: "\"'", hash: true,
  },
  matlab: {
    kw: words("function end if elseif else for while switch case otherwise return break continue try catch global persistent parfor"),
    ty: words("double single int8 int16 int32 int64 uint8 uint16 uint32 uint64 logical char cell struct"),
    lit: words("true false pi Inf NaN"), builtin: words("disp fprintf zeros ones size length numel max min sum mean abs"),
    line: "%", quotes: "'\"",
  },
  asm: {
    kw: words("mov movs mvn ldr ldrb ldrh str strb strh add adds sub subs mul mla and orr eor bic lsl lsr asr ror cmp cmn tst teq b bl bx blx beq bne bgt blt bge ble bhi blo push pop nop svc ldm stm cbz cbnz it"),
    ty: words("r0 r1 r2 r3 r4 r5 r6 r7 r8 r9 r10 r11 r12 r13 r14 r15 sp lr pc"),
    lit: words(""), line: ";", line2: "//", quotes: "\"'", nocase: true, hash: false,
  },
  pseudo: {
    kw: words("if then else elseif end endif for to step next while do repeat until return function procedure begin print input output and or not call declare set loop break continue"),
    ty: words("integer real string boolean array"), lit: words("true false null"),
    line: "//", line2: "#", block: ["/*", "*/"], quotes: "\"'", nocase: true,
  },
};
DEFS.typescript = {
  ...DEFS.javascript,
  kw: words(`${[...DEFS.javascript.kw].join(" ")} interface type enum implements readonly private public protected abstract declare namespace as keyof`),
  ty: words(`${[...DEFS.javascript.ty].join(" ")} number string boolean any unknown never void Record Partial`),
  at: true,
};

export function defOf(lang) {
  return DEFS[String(lang || "").toLowerCase()] || DEFS.pseudo;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const NUM_RE = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|(\d[\d_]*)?\.?\d[\d_]*([eE][+-]?\d+)?)[uUlLfF]*/;
const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

/** PURE: `code` as escaped HTML with `<span class="tk-…">` tokens. */
export function highlight(code, lang) {
  const d = defOf(lang);
  const src = String(code ?? "");
  const out = [];
  let i = 0;
  const n = src.length;
  const span = (cls, text) => out.push(`<span class="tk-${cls}">${esc(text)}</span>`);
  const lineStartOnlySpace = (pos) => {
    let j = pos - 1;
    while (j >= 0 && src[j] !== "\n") {
      if (src[j] !== " " && src[j] !== "\t") return false;
      j -= 1;
    }
    return true;
  };
  while (i < n) {
    const ch = src[i];
    const rest = src.slice(i, i + 3);
    // block comment
    if (d.block && src.startsWith(d.block[0], i)) {
      const end = src.indexOf(d.block[1], i + d.block[0].length);
      const stop = end < 0 ? n : end + d.block[1].length;
      span("com", src.slice(i, stop));
      i = stop;
      continue;
    }
    // line comments
    if ((d.line && src.startsWith(d.line, i)) || (d.line2 && src.startsWith(d.line2, i))) {
      // `#` in C-family is the preprocessor, handled below.
      if (!(d.hash && ch === "#")) {
        const end = src.indexOf("\n", i);
        const stop = end < 0 ? n : end;
        span("com", src.slice(i, stop));
        i = stop;
        continue;
      }
    }
    // preprocessor
    if (d.hash && ch === "#" && lineStartOnlySpace(i)) {
      const end = src.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      span("pp", src.slice(i, stop));
      i = stop;
      continue;
    }
    // triple-quoted strings (Python)
    if (d.triple && (rest === '"""' || rest === "'''")) {
      const end = src.indexOf(rest, i + 3);
      const stop = end < 0 ? n : end + 3;
      span("str", src.slice(i, stop));
      i = stop;
      continue;
    }
    // strings
    if (d.quotes && d.quotes.includes(ch)) {
      let j = i + 1;
      while (j < n && src[j] !== ch) {
        if (src[j] === "\\") j += 1;
        else if (src[j] === "\n" && ch !== "`") break;
        j += 1;
      }
      const stop = Math.min(n, j + 1);
      span("str", src.slice(i, stop));
      i = stop;
      continue;
    }
    // annotations / decorators
    if (d.at && ch === "@") {
      const m = ID_RE.exec(src.slice(i + 1));
      if (m) {
        span("pp", "@" + m[0]);
        i += 1 + m[0].length;
        continue;
      }
    }
    // shell variables
    if (d.dollar && ch === "$") {
      const m = /^\$(\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9#?@*$!-])/.exec(src.slice(i));
      if (m) {
        span("pp", m[0]);
        i += m[0].length;
        continue;
      }
    }
    // numbers
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] || ""))) {
      const prev = src[i - 1] || "";
      if (!/[A-Za-z_]/.test(prev)) {
        const m = NUM_RE.exec(src.slice(i));
        if (m && m[0]) {
          span("num", m[0]);
          i += m[0].length;
          continue;
        }
      }
    }
    // identifiers
    const m = /[A-Za-z_]/.test(ch) ? ID_RE.exec(src.slice(i)) : null;
    if (m) {
      const word = m[0];
      const key = d.nocase ? word.toLowerCase() : word;
      let cls = "";
      if (d.kw.has(key)) cls = "kw";
      else if (d.ty && d.ty.has(key)) cls = "ty";
      else if (d.lit && d.lit.has(key)) cls = "lit";
      else if (d.builtin && d.builtin.has(key)) cls = "fn";
      else {
        let j = i + word.length;
        while (src[j] === " ") j += 1;
        if (src[j] === "(") cls = "fn";
      }
      if (cls) span(cls, word);
      else out.push(esc(word));
      i += word.length;
      continue;
    }
    out.push(esc(ch));
    i += 1;
  }
  return out.join("");
}

/* ------------------------------------------------------------------------- */
/* Styles                                                                    */
/* ------------------------------------------------------------------------- */

const STYLE_ID = "kxCodeEditorStyles";
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
  .kxce{--ce-bg:#f8fafc;--ce-gutter:#eef2f7;--ce-gutter-fg:#94a3b8;--ce-gutter-on:#2563eb;--ce-fg:#0f172a;--ce-caret:#2563eb;
    --ce-sel:rgba(37,99,235,.18);--ce-border:#dbe3ee;--ce-line:rgba(37,99,235,.06);
    --tk-kw:#7c3aed;--tk-ty:#0369a1;--tk-str:#15803d;--tk-num:#c2410c;--tk-com:#94a3b8;--tk-pp:#be185d;--tk-fn:#1d4ed8;--tk-lit:#b45309;
    position:relative;display:flex;min-height:0;border:1px solid var(--ce-border);border-radius:12px;overflow:hidden;background:var(--ce-bg);
    font-family:"JetBrains Mono","Cascadia Code",Consolas,"Liberation Mono",monospace;font-size:14px;line-height:22px;tab-size:4}
  html.kx-dark .kxce{--ce-bg:#0b1020;--ce-gutter:#0f172a;--ce-gutter-fg:#475569;--ce-gutter-on:#93c5fd;--ce-fg:#e2e8f0;--ce-caret:#93c5fd;
    --ce-sel:rgba(147,197,253,.25);--ce-border:rgba(148,163,184,.22);--ce-line:rgba(147,197,253,.06);
    --tk-kw:#c4b5fd;--tk-ty:#7dd3fc;--tk-str:#86efac;--tk-num:#fdba74;--tk-com:#64748b;--tk-pp:#f9a8d4;--tk-fn:#93c5fd;--tk-lit:#fcd34d}
  .kxce:focus-within{border-color:var(--ce-caret);box-shadow:0 0 0 3px var(--ce-sel)}
  .kxce-gutter{flex:none;min-width:46px;padding:12px 10px 12px 8px;background:var(--ce-gutter);color:var(--ce-gutter-fg);text-align:right;
    user-select:none;overflow:hidden;white-space:pre;border-right:1px solid var(--ce-border)}
  .kxce-gutter .on{color:var(--ce-gutter-on);font-weight:700}
  .kxce-area{position:relative;flex:1;min-width:0;min-height:0;overflow:hidden}
  .kxce-hl,.kxce-ta{margin:0;padding:12px 14px;border:0;font:inherit;line-height:inherit;tab-size:inherit;letter-spacing:normal;
    white-space:pre;word-wrap:normal;overflow-wrap:normal;box-sizing:border-box}
  .kxce-hl{position:absolute;inset:0;color:var(--ce-fg);pointer-events:none;overflow:hidden}
  .kxce-ta{position:absolute;inset:0;width:100%;height:100%;resize:none;outline:none;background:transparent;color:transparent;
    caret-color:var(--ce-caret);overflow:auto;-webkit-text-fill-color:transparent}
  .kxce-ta::selection{background:var(--ce-sel);-webkit-text-fill-color:transparent}
  .kxce-ta::placeholder{color:var(--ce-gutter-fg);-webkit-text-fill-color:var(--ce-gutter-fg)}
  .kxce.readonly .kxce-area{overflow:auto}
  .kxce.readonly .kxce-hl{position:relative;inset:auto;overflow:visible;user-select:none}
  .tk-kw{color:var(--tk-kw);font-weight:600}.tk-ty{color:var(--tk-ty)}.tk-str{color:var(--tk-str)}.tk-num{color:var(--tk-num)}
  .tk-com{color:var(--tk-com);font-style:italic}.tk-pp{color:var(--tk-pp)}.tk-fn{color:var(--tk-fn)}.tk-lit{color:var(--tk-lit)}
  `;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

function lineNumbers(count, active) {
  const parts = [];
  for (let i = 1; i <= Math.max(1, count); i += 1) {
    parts.push(i === active ? `<span class="on">${i}</span>` : String(i));
  }
  return parts.join("\n");
}

/** Read-only code with line numbers + colours (the pseudo-code snippet). */
export function renderCodeBlock(code, lang) {
  injectStyles();
  const text = String(code || "");
  const wrap = document.createElement("div");
  wrap.className = "kxce readonly";
  const gutter = document.createElement("div");
  gutter.className = "kxce-gutter";
  gutter.setAttribute("aria-hidden", "true");
  gutter.innerHTML = lineNumbers(text.split("\n").length, 0);
  const area = document.createElement("div");
  area.className = "kxce-area";
  const pre = document.createElement("pre");
  pre.className = "kxce-hl";
  pre.innerHTML = highlight(text, lang) + "\n";
  area.appendChild(pre);
  wrap.append(gutter, area);
  // Selecting the snippet to copy it out is not allowed during the interview.
  ["copy", "cut", "contextmenu", "dragstart"].forEach((ev) => wrap.addEventListener(ev, (e) => e.preventDefault()));
  return wrap;
}

/**
 * The typing editor. `opts`: { value, language, ariaLabel, onChange(value),
 * onCursor({line, col}), onBlocked(message) }.
 */
export function createCodeEditor(opts = {}) {
  injectStyles();
  let lang = String(opts.language || "pseudo");
  const wrap = document.createElement("div");
  wrap.className = "kxce";
  const gutter = document.createElement("div");
  gutter.className = "kxce-gutter";
  gutter.setAttribute("aria-hidden", "true");
  const area = document.createElement("div");
  area.className = "kxce-area";
  const pre = document.createElement("pre");
  pre.className = "kxce-hl";
  pre.setAttribute("aria-hidden", "true");
  const ta = document.createElement("textarea");
  ta.className = "kxce-ta";
  ta.setAttribute("data-kx-code-editor", "true");
  ta.setAttribute("spellcheck", "false");
  ta.setAttribute("autocomplete", "off");
  ta.setAttribute("autocorrect", "off");
  ta.setAttribute("autocapitalize", "off");
  ta.setAttribute("wrap", "off");
  ta.setAttribute("aria-label", opts.ariaLabel || "Your code");
  ta.value = String(opts.value || "");
  area.append(pre, ta);
  wrap.append(gutter, area);

  let lastLines = -1;
  let lastActive = -1;
  const cursor = () => {
    const before = ta.value.slice(0, ta.selectionStart);
    const line = before.split("\n").length;
    const col = before.length - before.lastIndexOf("\n");
    return { line, col };
  };
  const paintGutter = () => {
    const lines = ta.value.split("\n").length;
    const { line, col } = cursor();
    if (lines !== lastLines || line !== lastActive) {
      gutter.innerHTML = lineNumbers(lines, line);
      lastLines = lines;
      lastActive = line;
    }
    opts.onCursor?.({ line, col });
  };
  const sync = () => {
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  };
  const paint = () => {
    // The trailing newline + space keeps the overlay as tall as the textarea.
    pre.innerHTML = highlight(ta.value, lang) + "\n ";
    paintGutter();
    sync();
  };

  const refuse = (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onBlocked?.("Copy and paste are turned off for coding questions — please type your answer.");
  };
  ["paste", "drop", "copy", "cut", "contextmenu", "dragstart"].forEach((ev) => ta.addEventListener(ev, refuse));

  const replaceSelection = (text, selectFrom, selectTo) => {
    const { selectionStart: a, selectionEnd: b, value } = ta;
    ta.value = value.slice(0, a) + text + value.slice(b);
    const caret = a + text.length;
    ta.selectionStart = selectFrom ?? caret;
    ta.selectionEnd = selectTo ?? caret;
  };
  ta.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value } = ta;
      const lineStart = value.lastIndexOf("\n", a - 1) + 1;
      if (a !== b && value.slice(a, b).includes("\n")) {
        // Indent / dedent every selected line.
        const block = value.slice(lineStart, b);
        const lines = block.split("\n");
        const next = e.shiftKey
          ? lines.map((l) => l.replace(/^( {1,4}|\t)/, ""))
          : lines.map((l) => "    " + l);
        const joined = next.join("\n");
        ta.value = value.slice(0, lineStart) + joined + value.slice(b);
        ta.selectionStart = lineStart;
        ta.selectionEnd = lineStart + joined.length;
      } else if (e.shiftKey) {
        const lead = value.slice(lineStart).match(/^( {1,4}|\t)/);
        if (lead) {
          ta.value = value.slice(0, lineStart) + value.slice(lineStart + lead[0].length);
          ta.selectionStart = ta.selectionEnd = Math.max(lineStart, a - lead[0].length);
        }
      } else {
        replaceSelection("    ");
      }
      paint();
      opts.onChange?.(ta.value);
      return;
    }
    if (e.key === "Enter") {
      // Keep the line's indent; one level deeper after an opening brace / colon.
      e.preventDefault();
      const { selectionStart: a, value } = ta;
      const lineStart = value.lastIndexOf("\n", a - 1) + 1;
      const line = value.slice(lineStart, a);
      const indent = (line.match(/^[ \t]*/) || [""])[0];
      const opens = /[{([:]\s*$/.test(line) && !/^\s*(#|\/\/|--|%)/.test(line);
      replaceSelection("\n" + indent + (opens ? "    " : ""));
      paint();
      opts.onChange?.(ta.value);
      return;
    }
    if (e.key === "}" || e.key === ")" || e.key === "]") {
      // A closing bracket typed on a blank, indented line steps back one level.
      const { selectionStart: a, selectionEnd: b, value } = ta;
      const lineStart = value.lastIndexOf("\n", a - 1) + 1;
      const before = value.slice(lineStart, a);
      if (a === b && /^ {4,}$/.test(before)) {
        e.preventDefault();
        ta.value = value.slice(0, a - 4) + e.key + value.slice(a);
        ta.selectionStart = ta.selectionEnd = a - 3;
        paint();
        opts.onChange?.(ta.value);
      }
    }
  });
  ta.addEventListener("input", () => {
    paint();
    opts.onChange?.(ta.value);
  });
  ta.addEventListener("scroll", sync);
  ["keyup", "click", "select"].forEach((ev) => ta.addEventListener(ev, paintGutter));

  paint();
  return {
    el: wrap,
    textarea: ta,
    getValue: () => ta.value,
    setValue: (v) => {
      ta.value = String(v || "");
      paint();
    },
    setLanguage: (l) => {
      lang = String(l || "pseudo");
      paint();
    },
    focus: () => ta.focus(),
    cursor,
  };
}
