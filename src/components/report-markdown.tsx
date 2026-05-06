"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const CRITERION_HEADINGS = new Set([
  "Centering",
  "Corners",
  "Edges",
  "Surfaces",
]);

/** Plain text from markdown-rendered heading children (may include strong/em). */
function markdownPlainText(children: React.ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) {
    return children.map(markdownPlainText).join("");
  }
  if (React.isValidElement(children)) {
    const props = children.props as { children?: React.ReactNode };
    return markdownPlainText(props.children);
  }
  return "";
}

function firstHeadingWord(title: string): string {
  return (title.trim().split(/\s+/)[0] ?? "").replace(/[:]+$/, "");
}

function isRubricCriterionHeading(title: string): boolean {
  return CRITERION_HEADINGS.has(firstHeadingWord(title));
}

/** Shared typography for main report + per-run markdown — matches Gem Mint chrome. */
export const REPORT_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mt-12 border-b border-slate-200 pb-4 text-xl font-semibold tracking-tight text-slate-900 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => {
    const plain = markdownPlainText(children);
    const rubric = isRubricCriterionHeading(plain);
    return (
      <h2
        className={
          rubric
            ? "mt-20 scroll-mt-6 border-t border-slate-100 pt-8 text-lg font-semibold tracking-tight text-slate-900 first:mt-0 border-b border-slate-200 pb-3"
            : "mt-14 border-b border-slate-200 pb-3 text-lg font-semibold tracking-tight text-slate-900 first:mt-0"
        }
      >
        {children}
      </h2>
    );
  },
  h3: ({ children }) => {
    const plain = markdownPlainText(children);
    const rubric = isRubricCriterionHeading(plain);
    return (
      <h3
        className={
          rubric
            ? "mt-16 scroll-mt-6 border-t border-slate-100 pt-6 text-base font-semibold text-slate-800 first:mt-0"
            : "mt-10 text-base font-semibold text-slate-800 first:mt-0"
        }
      >
        {children}
      </h3>
    );
  },
  p: ({ children }) => (
    <p className="mt-5 text-[15px] leading-[1.72] text-slate-700 first:mt-0">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="mt-5 list-disc space-y-3 pl-5 text-[15px] leading-relaxed text-slate-700 marker:text-blue-500">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-5 list-decimal space-y-3 pl-5 text-[15px] leading-relaxed text-slate-700 marker:text-blue-500">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-slate-900">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="text-slate-800 italic">{children}</em>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-8 border-l-[3px] border-blue-300 bg-blue-50/80 py-3 pl-5 pr-3 text-[14px] italic leading-relaxed text-slate-600">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const inline = !className;
    if (inline) {
      return (
        <code className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-blue-800 ring-1 ring-slate-200">
          {children}
        </code>
      );
    }
    return (
      <code className={className}>{children}</code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-[13px] leading-relaxed text-slate-700">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-12 border-slate-200" />,
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-blue-600 underline decoration-blue-300 underline-offset-2 transition hover:text-blue-800 hover:decoration-blue-400"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};

export function ReportMarkdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={REPORT_MARKDOWN_COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
