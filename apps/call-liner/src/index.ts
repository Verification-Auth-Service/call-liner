export function formatCallLine(name: string, phoneNumber: string): string {
  return `${name}: ${phoneNumber}`;
}

console.log(formatCallLine("Alice", "+1-555-0100"));

