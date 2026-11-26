import { JSX, onMount, onCleanup, createEffect } from 'solid-js';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: JSX.Element;
  footer?: JSX.Element;
}

export function Dialog(props: DialogProps) {
  let dialogRef: HTMLDialogElement | undefined;

  createEffect(() => {
    if (props.isOpen) {
      dialogRef?.showModal();
    } else {
      dialogRef?.close();
    }
  });

  return (
    <dialog
      ref={dialogRef}
      onClose={props.onClose}
      onClick={(e) => {
        // Close if clicked on backdrop (target is the dialog itself)
        if (e.target === dialogRef) {
          props.onClose();
        }
      }}
    >
      <article>
        <header class="page-header">
          <h3>{props.title}</h3>
          <button aria-label="Close" class="btn-icon" onClick={props.onClose}>
            <span class="material-icons" aria-hidden="true">
              close
            </span>
          </button>
        </header>
        {props.children}
        {props.footer && <footer class="actions">{props.footer}</footer>}
      </article>
    </dialog>
  );
}
