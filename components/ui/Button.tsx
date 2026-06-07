type ButtonVariant = "primary" | "secondary" | "danger"

type Props = {
  variant?: ButtonVariant
  fullWidth?: boolean
  disabled?: boolean
  onClick?: React.MouseEventHandler<HTMLButtonElement>
  children: React.ReactNode
  type?: "button" | "submit" | "reset"
  className?: string
}

export default function Button({
  variant = "primary",
  fullWidth = false,
  disabled = false,
  onClick,
  children,
  type = "button",
  className = ""
}: Props) {
  const base =
    "inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold transition-all focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-not-allowed active:scale-[0.98] sm:min-h-10"

  if (variant === "primary") {
    const primaryBlue = "#1652f0";
    return (
      <button
        type={type}
        disabled={disabled}
        onClick={onClick}
        style={{ background: disabled ? undefined : primaryBlue }}
        className={`${base} border border-transparent text-white shadow-[0_8px_20px_rgba(22,82,240,0.20)] hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_12px_28px_rgba(22,82,240,0.24)] disabled:bg-[#1652f0] disabled:text-white disabled:opacity-60 disabled:shadow-none ${fullWidth ? "w-full" : ""} ${className}`}
      >
        {children}
      </button>
    )
  }

  if (variant === "secondary") {
    return (
      <button
        type={type}
        disabled={disabled}
        onClick={onClick}
        className={`${base} border border-gray-200 bg-white text-gray-800 shadow-sm hover:bg-gray-50 hover:border-gray-300 hover:shadow-md active:bg-gray-100 disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none ${fullWidth ? "w-full" : ""} ${className}`}
      >
        {children}
      </button>
    )
  }

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${base} border border-red-200 bg-white text-red-600 shadow-sm hover:bg-red-50 hover:border-red-300 hover:text-red-700 hover:shadow-md disabled:bg-red-50 disabled:text-red-300 disabled:shadow-none ${fullWidth ? "w-full" : ""} ${className}`}
    >
      {children}
    </button>
  )
}
