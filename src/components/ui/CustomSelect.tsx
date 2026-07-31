import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

export interface CustomSelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface CustomSelectProps<T extends string = string> {
  value: T;
  options: CustomSelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  icon?: React.ReactNode;
  direction?: "auto" | "up" | "down";
}

export function CustomSelect<T extends string = string>({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Selecione...",
  className = "",
  icon,
  direction = "auto",
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    if (!open) return;

    if (direction === "up") {
      setDropUp(true);
    } else if (direction === "down") {
      setDropUp(false);
    } else if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setDropUp(spaceBelow < 180);
    }

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [open, direction]);

  return (
    <div
      ref={containerRef}
      className={`custom-select-wrap ${disabled ? "is-disabled" : ""} ${open ? "is-open" : ""} ${className}`}
    >
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
      >
        {icon && <span className="custom-select-icon">{icon}</span>}
        <span className="custom-select-label">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={14} className={`custom-select-arrow ${open ? "open" : ""}`} />
      </button>

      {open && !disabled && (
        <div
          className={`custom-select-dropdown ${dropUp ? "drop-up" : ""}`}
          style={{ backgroundColor: "#181a20", opacity: 1, backdropFilter: "none", WebkitBackdropFilter: "none" }}
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                className={`custom-select-option ${isSelected ? "selected" : ""} ${opt.disabled ? "disabled" : ""}`}
                onClick={() => {
                  if (opt.disabled) return;
                  onChange(opt.value);
                  setOpen(false);
                }}
                disabled={opt.disabled}
              >
                <span>{opt.label}</span>
                {isSelected && <Check size={14} className="custom-select-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
