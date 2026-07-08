import {describe,it,expect,vi,beforeEach} from 'vitest';
const m=vi.hoisted(()=>({lookup:vi.fn(),upload:vi.fn(),url:vi.fn()}));
vi.mock('../../utils/cloudinary.js',()=>({default:{api:{resource:m.lookup},utils:{private_download_url:m.url}},uploadBufferToCloudinary:m.upload}));
import {storePrivateImage,privateImageBytes} from './media.service.js';
beforeEach(()=>{vi.resetAllMocks();});
describe('protected storage recovery',()=>{
 it('uploads authenticated assets with no overwrite and a bound hash',async()=>{m.lookup.mockRejectedValue({error:{http_code:404}});m.upload.mockResolvedValue({asset_id:'a'});await storePrivateImage(Buffer.from('bytes'),'verification/1/attempts/a/original','hash');expect(m.upload).toHaveBeenCalledWith(expect.any(Buffer),expect.objectContaining({type:'authenticated',overwrite:false,context:{sha256:'hash'}}));});
 it('recovers stored-but-response-lost uploads without uploading twice',async()=>{m.lookup.mockResolvedValue({asset_id:'a',context:{custom:{sha256:'hash'}}});expect(await storePrivateImage(Buffer.from('bytes'),'verification/1/attempts/a/original','hash')).toMatchObject({asset_id:'a'});expect(m.upload).not.toHaveBeenCalled();});
 it('rejects changed bytes and refuses to upload when lookup is unavailable',async()=>{m.lookup.mockResolvedValue({context:{custom:{sha256:'different'}}});await expect(storePrivateImage(Buffer.from('bytes'),'verification/a','hash')).rejects.toThrow('does not match');m.lookup.mockRejectedValue({http_code:503});await expect(storePrivateImage(Buffer.from('bytes'),'verification/a','hash')).rejects.toThrow('unavailable');expect(m.upload).not.toHaveBeenCalled();});
 it('accepts only identifiers in the verification namespace, never arbitrary URLs',async()=>{await expect(privateImageBytes('https://example.com/secret','jpg')).rejects.toThrow('unavailable');expect(m.url).not.toHaveBeenCalled();});
});
