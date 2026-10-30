import { useState } from 'react';
import {
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const REQUIREMENTS = [
  'Clear, well-lit photos of your face',
  'Front-facing shots with both eyes visible',
  'Neutral or natural expressions',
  'Photos taken within the last 2 years',
  'Variety of backgrounds and settings',
  'High-resolution images (at least 512×512)',
];

const RESTRICTIONS = [
  'Group photos with multiple people',
  'Blurry, dark, or low-quality images',
  'Heavy filters, edits, or overlays',
  'Sunglasses, hats, or face-covering accessories',
  'Extremely cropped or zoomed-out images',
  'Screenshots or photos of photos',
];

interface AccordionPanelProps {
  icon: React.ReactNode;
  title: string;
  items: string[];
  defaultOpen?: boolean;
}

function AccordionPanel({
  icon,
  title,
  items,
  defaultOpen = false,
}: AccordionPanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = title.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
          {icon}
          {title}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-gray-400" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />
        )}
      </button>

      {open && (
        <ul id={panelId} className="px-4 pb-3 space-y-1.5" role="list">
          {items.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2 text-xs text-gray-500"
            >
              <span className="mt-0.5 block h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PhotoGuidelines() {
  return (
    <div className="space-y-2">
      <AccordionPanel
        icon={<CheckCircle className="h-4 w-4 text-success-500" aria-hidden="true" />}
        title="Photo Requirements"
        items={REQUIREMENTS}
        defaultOpen
      />
      <AccordionPanel
        icon={<XCircle className="h-4 w-4 text-danger-500" aria-hidden="true" />}
        title="Photo Restrictions"
        items={RESTRICTIONS}
      />
    </div>
  );
}
