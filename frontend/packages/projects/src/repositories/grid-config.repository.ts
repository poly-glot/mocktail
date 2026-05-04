import { Injectable, inject } from '@angular/core';
import { FirebaseService } from '@mocktail/core';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { IGridConfig } from '../interfaces/project.interface';
import { stripUndefined } from './element-codec';

@Injectable({ providedIn: 'root' })
export class GridConfigRepository {
  private readonly _firebase = inject(FirebaseService);

  public async updateGridConfig(tid: string, pid: string, gridConfig: IGridConfig): Promise<void> {
    await updateDoc(doc(this._firebase.db, 'tenants', tid, 'projects', pid), {
      gridConfig: stripUndefined(gridConfig),
      updatedAt: serverTimestamp(),
    });
  }
}
