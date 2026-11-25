import { screen, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

export async function openMoveOptions(user: ReturnType<typeof userEvent.setup>) {
  const results = within(screen.getByRole("region", { name: "Possible moves" }));
  const summary = await results.findByText("Options", { selector: "summary" });
  const menu = summary.closest("details")!;
  if (!menu.open) await user.click(summary);
  return within(menu);
}

export async function chooseMoveOption(
  user: ReturnType<typeof userEvent.setup>,
  name: string | RegExp,
) {
  const options = await openMoveOptions(user);
  await user.click(await options.findByRole("button", { name }));
}
