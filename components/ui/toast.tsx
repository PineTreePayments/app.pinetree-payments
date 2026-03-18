export default function Toast({ message }: { message: string }) {

  return (
    <div className="fixed bottom-6 right-6 bg-black text-white px-4 py-2 rounded">
      {message}
    </div>
  );
}