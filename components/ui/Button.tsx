type ButtonVariant = "primary" | "secondary" | "danger"

type Props = {
  variant?: ButtonVariant
  fullWidth?: boolean
  disabled?: boolean
  onClick?: () => unknown
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
    "inline-flex items-center justify-center font-semibold text-sm rounded-full h-[46px] px-6 transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"

  if (variant === "primary") {
    return (
      <button
        type={type}
        disabled={disabled}
        onClick={onClick}
        style={{ background: disabled ? undefined : "linear-gradient(135deg, #5cc8ff 0%, #7d3fe0 100%)" }}
        className={`${base} text-white hover:brightness-110 disabled:bg-gray-300 disabled:text-gray-500 ${fullWidth ? "w-full" : ""} ${className}`}
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
        className={`${base} bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300 ${fullWidth ? "w-full" : ""} ${className}`}
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
      className={`${base} bg-transparent text-red-500 hover:text-red-700 ${fullWidth ? "w-full" : ""} ${className}`}
    >
      {children}
    </button>
  )
}
