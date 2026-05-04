import { Pipe, PipeTransform } from '@angular/core';
import { peerInitials } from '../utils/presentation';

@Pipe({ name: 'peerInitials', standalone: true })
export class PeerInitialsPipe implements PipeTransform {
  public transform(name: string): string {
    return peerInitials(name);
  }
}
