# Installing KUDUTUNES on your own server

KUDUTUNES is a folder of files. The server only hands them out; all the listening happens in the visitor's browser,
so a small server is plenty and nothing needs to keep running besides the web server.

**You need**

- A server running Ubuntu or Debian that you can sign in to with `sudo`.
- A web address (a domain or sub-domain, for example `notes.example.com`) whose DNS **A record** points to the
  server's IP address. Recording with the microphone only works over **https**, and a certificate needs a name:
  a bare IP address won't do.
- Ports 80 and 443 open in the server's firewall.

In every command below, replace `notes.example.com` with your own address.

## 1. Get the files

```
sudo apt update && sudo apt install -y git
sudo git clone https://github.com/azeembukhariprivate/kudutunes /var/www/kudutunes
```

## 2. Hand them out over https

Use **A** if the server has no web server yet (it is the simplest: the certificate is fetched and renewed by
itself). Use **B** if nginx is already running other sites on it.

### A. With Caddy

```
sudo apt install -y caddy
sudo cp /var/www/kudutunes/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/notes.example.com/YOUR.ADDRESS.HERE/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

(If the `caddy` package isn't found, follow the install steps on caddyserver.com, then carry on from the `cp` line.
If Caddy already serves other sites, add the block from `deploy/Caddyfile` to your Caddyfile instead of replacing it.)

### B. With nginx

```
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp /var/www/kudutunes/deploy/nginx.conf /etc/nginx/sites-available/kudutunes
sudo sed -i 's/notes.example.com/YOUR.ADDRESS.HERE/' /etc/nginx/sites-available/kudutunes
sudo ln -s /etc/nginx/sites-available/kudutunes /etc/nginx/sites-enabled/kudutunes
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d YOUR.ADDRESS.HERE
```

Certbot adds the https part to the file and renews the certificate by itself.

### C. In a folder of a site nginx already serves (for example `https://example.com/kudutunes/`)

Follow the steps in `deploy/nginx-subfolder.conf`: one small part goes at the top of the site's file in
`/etc/nginx/sites-available/`, the rest inside its existing https `server { }` block. Back up that file first, then
`sudo nginx -t && sudo systemctl reload nginx`. The site keeps its certificate; nothing else on it changes.

## 3. Check it

Open `https://YOUR.ADDRESS.HERE/` in a browser.

- The first screen shows **Open a sound file**, **Record with the microphone** and **Open a project file**.
- Open a short recording of one instrument: after "Listening…" the piano roll and tabs appear.
- Press **Record with the microphone**: the browser asks to use the microphone. (If it says recording needs a secure
  address, the page isn't on https.)
- From the server: `curl -I https://YOUR.ADDRESS.HERE/vendor/listen/model/model.json` should say `200`, and
  `curl -I https://YOUR.ADDRESS.HERE/.git/config` should say `404`.

## Updating to a new version

```
cd /var/www/kudutunes && sudo git pull
```

Nothing needs restarting. People who have the app open get the new version the next time they open it (the app keeps
a copy of itself for working offline, and replaces it when the version number changes).

## Removing it

```
sudo rm -rf /var/www/kudutunes
```

and take its block out of the Caddyfile, or delete `/etc/nginx/sites-enabled/kudutunes` and
`/etc/nginx/sites-available/kudutunes`, then reload the web server.

## Good to know

- **Nothing is stored on the server.** Pieces live in each visitor's own browser. There is no database, no accounts
  and no upload, so there is nothing to back up.
- **Anyone who knows the address can use it.** That costs you only the download of the app (about 2 MB) per visitor.
  To keep it to yourself, add a password in the web server (`basic_auth` in Caddy, `auth_basic` in nginx).
- The set-ups in `deploy/` send safety rules that let the page load only its own files. If you write your own
  server set-up, copy the `Content-Security-Policy` line from one of them.
