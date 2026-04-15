const OSC_PATTERN = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
const CSI_PATTERN = /(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g;
const ESC_PATTERN = /\u001b[@-_]/g;
const C0_C1_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

export function stripTerminalControlSequences(text: string): string {
  return text
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(ESC_PATTERN, "")
    .replace(C0_C1_PATTERN, "");
}
