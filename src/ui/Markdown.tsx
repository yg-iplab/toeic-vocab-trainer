// lib/markdown.ts で読んだ中身を、React の要素として組み立てる（HTML を直接埋め込まない）
import type { ReactNode } from "react";
import type { Block, Inline } from "../lib/markdown";

function Inlines({ c }: { c: Inline[] }): ReactNode {
  return c.map((x, i) => {
    switch (x.t) {
      case "text":
        return x.v;
      case "b":
        return (
          <strong key={i}>
            <Inlines c={x.c} />
          </strong>
        );
      case "u":
        return (
          <u key={i}>
            <Inlines c={x.c} />
          </u>
        );
      case "code":
        return <code key={i}>{x.v}</code>;
      case "br":
        return <br key={i} />;
    }
  });
}

function BlockView({ b, base }: { b: Block; base: number }): ReactNode {
  switch (b.t) {
    case "h": {
      // 画面の見出し（h2）の下に入るので、1段下げる
      const level = Math.min(6, b.level + base);
      const Tag = `h${level}` as "h3";
      return (
        <Tag className={`md-h md-h${b.level}`}>
          <Inlines c={b.c} />
        </Tag>
      );
    }
    case "p":
      return (
        <p>
          <Inlines c={b.c} />
        </p>
      );
    case "hr":
      return <hr />;
    case "code":
      return (
        <pre className="md-pre">
          <code>{b.v}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote>
          <Blocks blocks={b.c} base={base} />
        </blockquote>
      );
    case "list": {
      const items = b.items.map((it, i) => (
        <li key={i}>
          <Blocks blocks={it} base={base} />
        </li>
      ));
      return b.ordered ? <ol start={b.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case "table":
      return (
        <div className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {b.head.map((c, i) => (
                  <th key={i} style={{ textAlign: b.align[i] }}>
                    <Inlines c={c} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, i) => (
                    <td key={i} style={{ textAlign: b.align[i] }}>
                      <Inlines c={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Blocks({ blocks, base = 1 }: { blocks: Block[]; base?: number }) {
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} base={base} />
      ))}
    </>
  );
}

export function Markdown({ blocks, base = 1 }: { blocks: Block[]; base?: number }) {
  return (
    <div className="md">
      <Blocks blocks={blocks} base={base} />
    </div>
  );
}
