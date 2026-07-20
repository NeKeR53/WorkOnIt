export function Icon({ name, label }: { name: string; label?: string }) {
  return (
    <span
      className="material-symbols-rounded icon"
      aria-hidden={label ? undefined : true}
      aria-label={label}
    >
      {name}
    </span>
  );
}
