import { Fragment } from "react";
import { messageLinks } from "@/lib/message-links";

export function MessageText({ text }: { text: string }) {
  return <>{messageLinks(text).map((part, index) => part.href
    ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2 hover:opacity-80">{part.text}</a>
    : <Fragment key={index}>{part.text}</Fragment>)}</>;
}
