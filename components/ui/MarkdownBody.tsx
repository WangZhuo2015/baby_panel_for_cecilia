"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownBody({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  if (!children.trim()) return null;
  return (
    <div className={`markdown-content space-y-1.5 text-sm text-text-primary ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-sm font-bold text-primary-dark mt-2 mb-1">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-bold text-text-primary mt-2.5 mb-1">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-xs font-bold text-text-primary mt-2 mb-0.5">{children}</h3>
          ),
          p: ({ children }) => <p className="my-1 leading-relaxed">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-bold text-text-primary">{children}</strong>
          ),
          ul: ({ children }) => (
            <ul className="my-1.5 pl-4 space-y-1 list-disc marker:text-primary/70">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 pl-4 space-y-1 list-decimal marker:text-primary">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 p-2.5 bg-primary-light/30 border-l-2 border-primary rounded-r-xl text-xs text-text-secondary">
              {children}
            </blockquote>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
