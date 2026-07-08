import { describe, expect, it, vi } from 'vitest';
import type { Price } from '@paddle/paddle-node-sdk';
import { getTrialRemovalCatalog, removePaddleTrials, type TrialRemovalResult } from './paddleTrialRemoval.js';

const catalog = getTrialRemovalCatalog();
function fixture() {
    const prices = new Map(catalog.map(entry => [entry.priceId, {
        id: entry.priceId,
        billingCycle: { interval: entry.interval, frequency: 1 },
        trialPeriod: { interval: 'day', frequency: 14 },
    } as Price]));
    const get = vi.fn(async (id: string) => structuredClone(prices.get(id)!));
    const update = vi.fn(async (id: string, body: { trialPeriod?: unknown; billingCycle?: unknown }) => {
        const price = prices.get(id)!;
        prices.set(id, { ...price, trialPeriod: null });
        return structuredClone(prices.get(id)!);
    });
    return { prices, get, update, deps: { provider: { prices: { get, update } }, env: { PADDLE_ENVIRONMENT: 'sandbox' } } };
}

describe('sandbox trial removal', () => {
    it('defaults to a preview of exactly the six repository prices without writes', async () => {
        const f = fixture();
        f.deps.env = { PADDLE_ENVIRONMENT: 'sandbox', PADDLE_PRICE_CATALOG_JSON: 'untrusted override' } as typeof f.deps.env;
        const results = await removePaddleTrials({}, f.deps);
        expect(results.map(result => result.priceId)).toEqual(catalog.map(entry => entry.priceId));
        expect(results.every(result => result.status === 'WOULD_REMOVE' && result.failure === null)).toBe(true);
        expect(f.get.mock.calls.map(([id]) => id)).toEqual(catalog.map(entry => entry.priceId));
        expect(f.update).not.toHaveBeenCalled();
    });

    it.each(['production', '', 'SANDBOX', undefined])('refuses environment %s before reads or writes', async environment => {
        const f = fixture();
        await expect(removePaddleTrials({ apply: true }, { ...f.deps, env: { PADDLE_ENVIRONMENT: environment } }))
            .rejects.toThrow('requires PADDLE_ENVIRONMENT=sandbox');
        expect(f.get).not.toHaveBeenCalled();
        expect(f.update).not.toHaveBeenCalled();
    });

    it('also refuses production previews', async () => {
        const f = fixture();
        await expect(removePaddleTrials({}, { ...f.deps, env: { PADDLE_ENVIRONMENT: 'production' } })).rejects.toThrow();
        expect(f.get).not.toHaveBeenCalled();
    });

    it('applies null trials with the exact existing billing cycle and reads every price back', async () => {
        const f = fixture();
        const results = await removePaddleTrials({ apply: true }, f.deps);
        expect(results.every(result => result.status === 'REMOVED' && result.failure === null)).toBe(true);
        expect(f.update).toHaveBeenCalledTimes(6);
        expect(f.get).toHaveBeenCalledTimes(12);
        for (const entry of catalog) {
            expect(f.update).toHaveBeenCalledWith(entry.priceId, {
                trialPeriod: null, billingCycle: { interval: entry.interval, frequency: 1 },
            });
            expect(f.get.mock.calls.filter(([id]) => id === entry.priceId)).toHaveLength(2);
        }
    });

    it('skips already clear prices in both preview and apply, including a completed rerun', async () => {
        const f = fixture();
        await removePaddleTrials({ apply: true }, f.deps);
        f.update.mockClear();
        for (const apply of [false, true]) {
            expect((await removePaddleTrials({ apply }, f.deps)).every(result => result.status === 'ALREADY_CLEAR')).toBe(true);
        }
        expect(f.update).not.toHaveBeenCalled();
    });

    it('reports partial write failure, continues, and reruns only the remaining price', async () => {
        const f = fixture();
        f.update.mockRejectedValueOnce(new Error('private provider payload'));
        const results = await removePaddleTrials({ apply: true }, f.deps);
        expect(results[0]).toMatchObject({ status: 'FAILED', failure: 'VERIFICATION_FAILED' });
        expect(results.slice(1).every(result => result.status === 'REMOVED')).toBe(true);
        expect(JSON.stringify(results)).not.toContain('private provider payload');
        expect(f.get).toHaveBeenCalledTimes(12);
        f.update.mockClear();
        const rerun = await removePaddleTrials({ apply: true }, f.deps);
        expect(rerun[0].status).toBe('REMOVED');
        expect(rerun.slice(1).every(result => result.status === 'ALREADY_CLEAR')).toBe(true);
        expect(f.update).toHaveBeenCalledTimes(1);
        expect(f.update.mock.calls[0][0]).toBe(catalog[0].priceId);
    });

    it('continues after a read failure without writing the unread price', async () => {
        const f = fixture();
        f.get.mockRejectedValueOnce(new Error('secret'));
        const results = await removePaddleTrials({ apply: true }, f.deps);
        expect(results[0]).toMatchObject({ status: 'FAILED', failure: 'READ_FAILED' });
        expect(results.slice(1).every(result => result.status === 'REMOVED')).toBe(true);
        expect(f.update).toHaveBeenCalledTimes(5);
    });

    it.each(['identity', 'cycle'])('refuses unexpected price %s before writing', async invalid => {
        const f = fixture();
        const price = f.prices.get(catalog[0].priceId)!;
        f.prices.set(catalog[0].priceId, { ...price,
            ...(invalid === 'identity' ? { id: 'pri_unconfigured' } : {}),
            ...(invalid === 'cycle' ? { billingCycle: null } : {}),
        });
        const results = await removePaddleTrials({ apply: true }, f.deps);
        expect(results[0]).toMatchObject({ status: 'FAILED', failure: 'INVALID_PRICE' });
        expect(f.update).toHaveBeenCalledTimes(5);
    });

    it('preserves the actual billing cycle even when it differs from the catalog interval', async () => {
        const f = fixture();
        const id = catalog[0].priceId;
        f.prices.set(id, { ...f.prices.get(id)!, billingCycle: { interval: 'week', frequency: 2 } });
        expect((await removePaddleTrials({ apply: true }, f.deps))[0].status).toBe('REMOVED');
        expect(f.update).toHaveBeenCalledWith(id, { trialPeriod: null, billingCycle: { interval: 'week', frequency: 2 } });
    });

    it('does not trust an update response without a fresh read', async () => {
        const f = fixture();
        f.update.mockImplementationOnce(async id => ({ ...f.prices.get(id)!, trialPeriod: null }));
        expect((await removePaddleTrials({ apply: true }, f.deps))[0])
            .toMatchObject({ status: 'FAILED', failure: 'VERIFICATION_FAILED' });
    });

    it('reports failed verification reads and continues', async () => {
        const f = fixture();
        f.get.mockResolvedValueOnce(structuredClone(f.prices.get(catalog[0].priceId)!))
            .mockRejectedValueOnce(new Error('secret'));
        const results = await removePaddleTrials({ apply: true }, f.deps);
        expect(results[0].failure).toBe('VERIFICATION_FAILED');
        expect(results.slice(1).every(result => result.status === 'REMOVED')).toBe(true);
    });

    it('resolves uncertain writes only by reading the actual resulting price', async () => {
        const f = fixture();
        f.update.mockImplementationOnce(async id => {
            f.prices.set(id, { ...f.prices.get(id)!, trialPeriod: null });
            throw new Error('timeout');
        });
        expect((await removePaddleTrials({ apply: true }, f.deps))[0].status).toBe('REMOVED');
    });

    it('fails verification when the billing cycle changes', async () => {
        const f = fixture();
        f.update.mockImplementationOnce(async id => {
            const changed = { ...f.prices.get(id)!, trialPeriod: null, billingCycle: null };
            f.prices.set(id, changed);
            return changed;
        });
        expect((await removePaddleTrials({ apply: true }, f.deps))[0].failure).toBe('VERIFICATION_FAILED');
    });
});

describe('thin command (injected runner only)', () => {
    async function command() {
        return vi.importActual<{ main: (
            args: string[], run: typeof removePaddleTrials, output: (line: string) => void,
        ) => Promise<number> }>('../../scripts/removePaddleTrials.ts');
    }
    it.each([{ args: [] }, { args: ['--apply'] }])('passes explicit apply choice for $args', async ({ args }) => {
        const { main } = await command();
        const run = vi.fn(async () => [] as TrialRemovalResult[]);
        expect(await main(args, run, vi.fn())).toBe(0);
        expect(run).toHaveBeenCalledWith({ apply: args.includes('--apply') });
    });
    it.each([{ args: ['--force'] }, { args: ['--apply', '--apply'] }])('rejects unsupported arguments $args without invoking the runner', async ({ args }) => {
        const { main } = await command();
        const run = vi.fn();
        expect(await main(args, run, vi.fn())).toBe(1);
        expect(run).not.toHaveBeenCalled();
    });
    it('prints per-price results and returns failure for a partial failure', async () => {
        const { main } = await command();
        const output = vi.fn();
        const result: TrialRemovalResult = { ...catalog[0], status: 'FAILED', failure: 'READ_FAILED' };
        expect(await main([], async () => [result], output)).toBe(1);
        expect(output).toHaveBeenCalledWith(expect.stringContaining(`${result.priceId}: FAILED (READ_FAILED)`));
    });
    it('does not print raw configuration or provider exceptions', async () => {
        const { main } = await command();
        const output = vi.fn();
        expect(await main([], async () => { throw new Error('secret token'); }, output)).toBe(1);
        expect(JSON.stringify(output.mock.calls)).not.toContain('secret token');
    });
});
