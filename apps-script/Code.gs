// 예약 녹음기 → Google Drive 업로드 창구.
// 폰이 8MB씩 보내면 Drive resumable upload 세션에 이어 붙여서 파일 하나로 만듦.
const SECRET = '__SECRET__';
const FOLDER_NAME = '아이폰 녹음';

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad json' }); }
  if (req.secret !== SECRET) return out_({ ok: false, error: 'secret이 안 맞아' });
  try {
    if (req.action === 'ping') return out_({ ok: true, folder: folder_().getUrl() });
    if (req.action === 'start') return out_({ ok: true, session: start_(req.name, req.mime) });
    if (req.action === 'chunk') return out_(chunk_(req));
    if (req.action === 'status') return out_(status_(req.session));
    return out_({ ok: false, error: 'unknown action' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  }
}

function doGet() { return out_({ ok: true, msg: 'recorder upload endpoint' }); }

// 처음 배포할 때 편집기에서 한 번 실행해서 권한 승인 + 폴더 생성.
function setup() { Logger.log(folder_().getUrl()); }

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function folder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}

function auth_() { return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }; }

function start_(name, mime) {
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: Object.assign(auth_(), { 'X-Upload-Content-Type': mime || 'audio/mp4' }),
    payload: JSON.stringify({ name: name, parents: [folder_().getId()] }),
    muteHttpExceptions: true,
    followRedirects: false,
  });
  if (res.getResponseCode() !== 200) throw new Error('세션 생성 실패 ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  const h = res.getAllHeaders();
  return h['Location'] || h['location'];
}

function put_(session, range, bytes, mime) {
  return UrlFetchApp.fetch(session, {
    method: 'put',
    contentType: mime || 'application/octet-stream',
    headers: Object.assign(auth_(), { 'Content-Range': range }),
    payload: bytes,
    muteHttpExceptions: true,
    followRedirects: false,
  });
}

function result_(res) {
  const code = res.getResponseCode();
  if (code === 308) {
    const h = res.getAllHeaders();
    const r = h['Range'] || h['range'];
    return { ok: true, next: r ? Number(String(r).split('-')[1]) + 1 : 0 };
  }
  if (code === 200 || code === 201) {
    const f = JSON.parse(res.getContentText());
    return { ok: true, done: true, id: f.id, url: 'https://drive.google.com/file/d/' + f.id + '/view' };
  }
  if (code === 404 || code === 410) return { ok: true, expired: true };
  return { ok: false, error: 'PUT ' + code + ' ' + res.getContentText().slice(0, 300) };
}

function chunk_(req) {
  const bytes = Utilities.base64Decode(req.data || '');
  const start = req.offset;
  const total = req.final ? String(start + bytes.length) : '*';
  const range = bytes.length ? 'bytes ' + start + '-' + (start + bytes.length - 1) + '/' + total : 'bytes */' + total;
  return result_(put_(req.session, range, bytes, req.mime));
}

function status_(session) {
  return result_(put_(session, 'bytes */*', '', 'application/octet-stream'));
}
