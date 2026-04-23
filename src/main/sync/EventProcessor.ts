/**
 * Processes Drive events received from the SDK and translates them
 * into local sync operations.
 *
 * The SDK documentation mandates event-based sync – no polling.
 */
import { EventEmitter } from 'events';
import { DriveEventType } from '@protontech/drive-sdk';
import type { DriveEvent } from '@protontech/drive-sdk';
import type { DriveService } from '../drive/DriveService';
import type { IpcNode } from '../../shared/ipc-types';

export class EventProcessor extends EventEmitter {
  constructor(private readonly drive: DriveService) {
    super();
  }

  /**
   * Process a single Drive event.  Never throws – errors are emitted
   * as 'error' events so callers can react without try/catch.
   */
  async process(event: DriveEvent): Promise<void> {
    try {
      await this.dispatch(event);
    } catch (err) {
      this.emit('error', err, event);
    }
  }

  private async dispatch(event: DriveEvent): Promise<void> {
    switch (event.type) {
      case DriveEventType.NodeCreated:
      case DriveEventType.NodeUpdated: {
        const node = await this.drive.getNode(event.nodeUid);
        this.emit('node-upserted', node, event);
        break;
      }

      case DriveEventType.NodeDeleted:
        this.emit('node-deleted', event.nodeUid, event);
        break;

      case DriveEventType.SharedWithMeUpdated:
        this.emit('shared-with-me-updated', event);
        break;

      case DriveEventType.TreeRefresh:
      case DriveEventType.FastForward:
        // Full refresh requested – clear local state and re-enumerate
        this.emit('full-refresh', event.treeEventScopeId);
        break;

      case DriveEventType.TreeRemove:
        this.emit('tree-removed', event.treeEventScopeId);
        break;

      default:
        // New event type – log and ignore for forward compatibility
        console.warn('[EventProcessor] Unknown event type:', (event as { type: string }).type);
    }
  }
}
