"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

export type SegmentedControlOption<T extends string> = {
  id: T;
  label: string;
  count?: number;
  dirty?: boolean;
};

type SegmentedControlProps<T extends string> = {
  label: string;
  value: T;
  options: Array<SegmentedControlOption<T>>;
  onChange: (value: T) => void;
  className?: string;
};

type AppToolbarProps = {
  title?: string;
  meta?: ReactNode;
  children?: ReactNode;
  className?: string;
};

type SearchableSelectChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

type OptionProps = {
  value?: string | number;
  disabled?: boolean;
  children?: ReactNode;
};

type SearchableSelectOption = {
  value: string;
  label: string;
  searchText: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  value?: string | number;
  onChange?: (event: SearchableSelectChangeEvent) => void;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  style?: CSSProperties;
  id?: string;
  name?: string;
  "aria-disabled"?: boolean | "true" | "false";
  "aria-label"?: string;
};

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textFromNode).join(" ");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromNode(node.props.children);
  }
  return "";
}

function optionsFromChildren(children: ReactNode): SearchableSelectOption[] {
  return Children.toArray(children)
    .filter(isValidElement)
    .map((child) => child as ReactElement<OptionProps>)
    .map((child) => {
      const label = textFromNode(child.props.children).replace(/\s+/g, " ").trim();
      const value = child.props.value === undefined ? label : String(child.props.value);
      return {
        value,
        label: label || value,
        searchText: `${label} ${value}`.toLowerCase(),
        disabled: child.props.disabled,
      };
    });
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={joinClasses("queue-focus-tabs", "app-segmented-control", className)} role="tablist" aria-label={label}>
      {options.map((item) => {
        const selected = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`btn ${selected ? "btn-primary" : "btn-ghost"}`}
            onClick={() => onChange(item.id)}
          >
            {item.label}
            {typeof item.count === "number" ? ` (${item.count})` : ""}
            {item.dirty ? " *" : ""}
          </button>
        );
      })}
    </div>
  );
}

export function SearchableSelect({
  value,
  onChange,
  children,
  disabled,
  className,
  placeholder = "Select an option",
  searchPlaceholder = "Search options...",
  style,
  id,
  name,
  "aria-disabled": ariaDisabled,
  "aria-label": ariaLabel,
}: SearchableSelectProps) {
  const generatedId = useId();
  const listboxId = `${generatedId}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const options = useMemo(() => optionsFromChildren(children), [children]);
  const currentValue = value === undefined || value === null ? "" : String(value);
  const selected = options.find((option) => option.value === currentValue);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredOptions = useMemo(
    () => (normalizedQuery ? options.filter((option) => option.searchText.includes(normalizedQuery)) : options),
    [normalizedQuery, options],
  );
  const isDisabled = disabled || ariaDisabled === true || ariaDisabled === "true";

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setQuery("");
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  const commitValue = (nextValue: string, optionDisabled?: boolean) => {
    if (isDisabled || optionDisabled) {
      return;
    }
    onChange?.({ target: { value: nextValue }, currentTarget: { value: nextValue } });
    setQuery("");
    setOpen(false);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setOpen(false);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const firstEnabled = filteredOptions.find((option) => !option.disabled);
      if (firstEnabled) {
        commitValue(firstEnabled.value);
      }
    }
  };

  return (
    <div
      ref={rootRef}
      className={joinClasses("custom-select", open && "custom-select-open", className)}
      style={style}
      data-disabled={isDisabled ? "true" : undefined}
      data-name={name}
      id={id}
    >
      <button
        type="button"
        className="custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-disabled={isDisabled}
        aria-label={ariaLabel}
        disabled={isDisabled}
        onClick={() => {
          if (open) {
            setQuery("");
          }
          setOpen(!open);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={selected ? "custom-select-value" : "custom-select-placeholder"}>{selected?.label || placeholder}</span>
        <span className="custom-select-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="custom-select-popover">
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder={searchPlaceholder}
            className="custom-select-search"
          />
          <div className="custom-select-options" role="listbox" id={listboxId}>
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  key={`${option.value}-${option.label}`}
                  type="button"
                  role="option"
                  aria-selected={option.value === currentValue}
                  className="custom-select-option"
                  disabled={option.disabled}
                  onClick={() => commitValue(option.value, option.disabled)}
                >
                  {option.label}
                </button>
              ))
            ) : (
              <p className="custom-select-empty">No matches</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AppToolbar({ title, meta, children, className }: AppToolbarProps) {
  return (
    <div className={joinClasses("app-toolbar", className)}>
      {title || meta ? (
        <div className="app-toolbar-copy">
          {title ? <h3>{title}</h3> : null}
          {meta ? <p className="queue-meta">{meta}</p> : null}
        </div>
      ) : null}
      {children ? <div className="app-toolbar-actions">{children}</div> : null}
    </div>
  );
}
