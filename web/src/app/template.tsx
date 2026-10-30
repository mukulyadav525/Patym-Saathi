// A template (unlike a layout) remounts on every navigation, so each page plays its entry animation.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
