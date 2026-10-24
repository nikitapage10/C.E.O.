/**
 * drei's <Html> labels (nameplates, speech bubbles, callouts) each run a React root of their own. Taken down in a
 * hurry (a room left for the map, #332, or Brogu's nameplate as the focus moves), one of those roots can try to remove
 * a node that is already gone, and React throws "Failed to execute 'removeChild' on 'Node'" from its commit: nothing
 * is broken, the node was on its way out anyway, but the throw is uncaught. This lets that one case pass: a child that
 * has already left every parent is not removed again. Anything else goes to the browser as before. (The same guard
 * React's own issue tracker suggests for the case, facebook/react#11538.)
 */
let installed = false;

export function guardRemoveChild() {
  if (installed || typeof Node === "undefined") return;
  installed = true;
  const remove = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode === null) return child;
    return remove.call(this, child) as T;
  };
}
