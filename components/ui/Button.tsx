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
    "inline-flex items-center justify-center font-semibold text-sm rounded-md h-10 px-4 transition-all focus:outline-none disabled:cursor-not-allowed active:scale-[0.98]"

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
        className={`${base} border border-transparent text-white shadow-sm hover:brightness-110 hover:shadow-md disabled:bg-blue-100 disabled:text-blue-300 disabled:shadow-none ${fullWidth ? "w-full" : ""} ${className}`}
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
