import { Mail } from "lucide-react";

const contactEmail = "hygeneops@gmail.com";

// Brand SVG paths from Simple Icons (CC0).
const socialLinks = [
  {
    brand: "instagram",
    label: "Hygene Ops on Instagram",
    href: "https://www.instagram.com/hygeneops/",
    path: "M12 0C8.74 0 8.332.014 7.052.072 5.775.131 4.903.334 4.14.63a5.88 5.88 0 0 0-2.126 1.384A5.88 5.88 0 0 0 .63 4.14c-.296.763-.5 1.635-.558 2.912C.014 8.332 0 8.74 0 12s.014 3.668.072 4.948c.059 1.277.262 2.149.558 2.912a5.88 5.88 0 0 0 1.384 2.126A5.88 5.88 0 0 0 4.14 23.37c.763.296 1.635.5 2.912.558C8.332 23.986 8.74 24 12 24s3.668-.014 4.948-.072c1.277-.059 2.149-.262 2.912-.558a5.88 5.88 0 0 0 2.126-1.384 5.88 5.88 0 0 0 1.384-2.126c.296-.763.5-1.635.558-2.912C23.986 15.668 24 15.26 24 12s-.014-3.668-.072-4.948c-.059-1.277-.262-2.149-.558-2.912a5.88 5.88 0 0 0-1.384-2.126A5.88 5.88 0 0 0 19.86.63c-.763-.296-1.635-.5-2.912-.558C15.668.014 15.26 0 12 0zm0 2.162c3.205 0 3.584.012 4.85.07 1.17.053 1.805.249 2.228.413.56.218.959.478 1.38.898.42.42.68.82.897 1.38.165.422.36 1.057.414 2.227.058 1.266.07 1.645.07 4.85s-.012 3.584-.07 4.85c-.053 1.17-.249 1.805-.414 2.228a3.717 3.717 0 0 1-.898 1.38c-.42.42-.82.68-1.38.897-.422.165-1.057.36-2.227.414-1.266.058-1.645.07-4.85.07s-3.584-.012-4.85-.07c-1.17-.053-1.805-.249-2.228-.414a3.717 3.717 0 0 1-1.38-.898 3.717 3.717 0 0 1-.897-1.38c-.165-.422-.36-1.057-.414-2.227-.058-1.266-.07-1.645-.07-4.85s.012-3.584.07-4.85c.053-1.17.249-1.805.414-2.228.218-.56.478-.959.898-1.38.42-.42.82-.68 1.38-.897.422-.165 1.057-.36 2.227-.414 1.266-.058 1.645-.07 4.85-.07zm0 3.676a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm7.846-10.405a1.44 1.44 0 1 1-2.88 0 1.44 1.44 0 0 1 2.88 0z",
  },
  {
    brand: "facebook",
    label: "Hygene Ops on Facebook",
    href: "https://www.facebook.com/profile.php?id=61596747781936",
    path: "M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.963H15.83c-1.491 0-1.956.931-1.956 1.886v2.272h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z",
  },
  {
    brand: "youtube",
    label: "Hygene Ops on YouTube",
    href: "https://www.youtube.com/@Hygeneops",
    path: "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.016 3.016 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.016 3.016 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  },
];

export function SocialLinks() {
  return (
    <div className="hx-footer-contact" role="group" aria-label="Contact and follow Hygene Ops">
      <div className="hx-footer-contact-block">
        <span className="hx-footer-label">Contact</span>
        <a
          className="hx-footer-email"
          href={`mailto:${contactEmail}`}
          aria-label={`Email Hygene Ops at ${contactEmail}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Mail size={18} aria-hidden="true" />
          <bdi>{contactEmail}</bdi>
        </a>
      </div>
      <div className="hx-footer-contact-block">
        <span className="hx-footer-label">Follow us</span>
        <div className="hx-footer-socials">
          {socialLinks.map(({ brand, href, label, path }) => (
            <a
              key={brand}
              href={href}
              aria-label={label}
              target="_blank"
              rel="noopener noreferrer"
              data-brand={brand}
            >
              <svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d={path} />
              </svg>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
