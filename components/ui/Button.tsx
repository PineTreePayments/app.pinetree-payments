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
    "inline-flex items-center justify-center font-semibold text-sm rounded-full h-[46px] px-6 transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"

  if (variant === "primary") {
    // Use a solid professional blue for primary actions, matching the Coinbase style.
    // The color #1652f0 is the suggested primary blue; fallback to #0052FF if needed.
    const primaryBlue = "#1652f0";
    return (
      <button
        type={type}
        disabled={disabled}
        onClick={onClick}
        style={{ background: disabled ? undefined : primaryBlue }}
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
