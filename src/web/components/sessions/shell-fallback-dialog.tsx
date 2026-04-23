import React from "react";

export interface ShellFallbackDialogProps {
  open: boolean;
  command: string;
  onCommandChange: (command: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  errorMessage?: string;
}

export function ShellFallbackDialog({
  open,
  command,
  onCommandChange,
  onCancel,
  onSubmit,
  errorMessage,
}: ShellFallbackDialogProps): React.JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog-panel" role="dialog" aria-modal="true" aria-labelledby="shell-fallback-title">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Fallback</p>
            <h3 id="shell-fallback-title">Shell fallback</h3>
          </div>
        </div>
        <label className="field-label" htmlFor="shell-fallback-command">Shell command</label>
        <textarea
          id="shell-fallback-command"
          className="command-textarea"
          rows={4}
          value={command}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            onCommandChange(event.target.value);
          }}
        />
        {errorMessage !== undefined && <p className="muted">{errorMessage}</p>}
        <div className="command-row dialog-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="ghost-button danger-button" type="button" onClick={onSubmit}>Run shell fallback</button>
        </div>
      </div>
    </div>
  );
}
