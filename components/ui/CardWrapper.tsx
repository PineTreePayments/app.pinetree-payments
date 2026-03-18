export default function CardWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-2xl shadow-inner p-6 h-[520px] flex flex-col overflow-hidden">
      {children}
    </div>
  );
}