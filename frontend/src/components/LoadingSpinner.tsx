export default function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#333] border-t-white rounded-full animate-spin" />
    </div>
  );
}
