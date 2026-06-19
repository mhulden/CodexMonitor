import { useEffect, useRef } from "react";
import { ModalShell } from "../../design-system/components/modal/ModalShell";

type RemoteWorkspacePathPromptProps = {
  value: string;
  error: string | null;
  recentPaths: string[];
  onChange: (value: string) => void;
  onRecentPathSelect: (path: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RemoteWorkspacePathPrompt({
  value,
  error,
  recentPaths,
  onChange,
  onRecentPathSelect,
  onCancel,
  onConfirm,
}: RemoteWorkspacePathPromptProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusTextareaAtEnd = () => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  };

  useEffect(() => {
    focusTextareaAtEnd();
  }, []);

  return (
    <ModalShell
      ariaLabel="Add remote workspace paths"
      className="remote-workspace-path-modal"
      cardClassName="remote-workspace-path-modal-card"
      onBackdropClick={onCancel}
    >
      <div className="remote-workspace-path-modal-content">
        <div className="ds-modal-title">Add project directories</div>
        <div className="ds-modal-subtitle">
          Enter directories on the connected server.
        </div>
        <label className="ds-modal-label" htmlFor="remote-workspace-paths">
          Paths
        </label>
        <textarea
          id="remote-workspace-paths"
          ref={textareaRef}
          className="ds-modal-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={"/home/vlad/dev/project-one\n/home/vlad/dev/project-two"}
          rows={4}
          wrap="off"
        />
        <div className="remote-workspace-path-modal-hint">
          One path per line. Comma and semicolon separators also work. You can use
          `~/...`. Paths are resolved on the remote daemon, not this computer.
        </div>
        {recentPaths.length > 0 && (
          <div className="remote-workspace-path-modal-recent">
            <div className="remote-workspace-path-modal-recent-title">Recently added</div>
            <div className="remote-workspace-path-modal-recent-list">
              {recentPaths.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="remote-workspace-path-modal-recent-item"
                  onClick={() => {
                    onRecentPathSelect(path);
                    requestAnimationFrame(() => {
                      focusTextareaAtEnd();
                    });
                  }}
                >
                  {path}
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <div className="ds-modal-error">{error}</div>}
        <div className="ds-modal-actions">
          <button className="ghost ds-modal-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="primary ds-modal-button" onClick={onConfirm} type="button">
            Add
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
