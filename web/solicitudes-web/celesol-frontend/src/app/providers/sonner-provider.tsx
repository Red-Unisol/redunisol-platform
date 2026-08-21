import { Toaster } from "sonner";

export function SonnerProvider() {
  return (
    <Toaster
      closeButton
      expand={false}
      gap={8}
      offset={24}
      position="bottom-center"
      style={{ width: "min(600px, calc(100vw - 2rem))" }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "pointer-events-auto relative mx-auto flex w-full items-center gap-3 rounded-md border px-4 py-3 shadow-none",
          success: "border-success bg-success text-success-foreground",
          error: "border-danger bg-danger text-danger-foreground",
          content: "flex-1 pr-10",
          title: "text-sm font-medium leading-5",
          description: "text-sm leading-5",
          closeButton:
            "absolute left-auto right-3 top-2 flex size-7 items-center justify-center rounded-sm border-0 bg-transparent opacity-100 hover:bg-white/10",
          icon: "m-0",
        },
      }}
      visibleToasts={1}
    />
  );
}
