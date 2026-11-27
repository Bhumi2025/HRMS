import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { ApiService } from '../api/api.service';
import { KeyStoreItem } from '../api/api.models';

@Injectable({
  providedIn: 'root',
})
export class KeyGroupCacheService {
  private readonly api = inject(ApiService);
  private readonly cache = new Map<string, { expiresAt: number; obs: Observable<KeyStoreItem[]> }>();
  private static readonly TTL_MS = 3000;

  /**
   * Retrieves active KeyStores for a given groupCode, sharing in-flight/recent
   * requests within a short TTL while staying fresh with Settings edits.
   */
  getOptions(groupCode: string): Observable<KeyStoreItem[]> {
    const key = groupCode.trim().toUpperCase();
    const now = Date.now();
    const existing = this.cache.get(key);
    if (existing && existing.expiresAt > now) {
      return existing.obs;
    }

    const obs = this.api.keyStoresByGroup(key).pipe(
      map((items) => (items ? [...items] : [])),
      shareReplay(1)
    );

    this.cache.set(key, { expiresAt: now + KeyGroupCacheService.TTL_MS, obs });
    return obs;
  }

  /**
   * Clears the cache for a specific groupCode or all groups when an administrator
   * updates or saves KeyGroups in Settings.
   */
  clearCache(groupCode?: string): void {
    if (groupCode) {
      this.cache.delete(groupCode.trim().toUpperCase());
    } else {
      this.cache.clear();
    }
  }
}
