import { SVGAttributes } from 'react';

export default function AppLogoIcon(props: SVGAttributes<SVGElement>) {
    return (
        <svg {...props} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            <circle cx="32" cy="32" r="30" />
            <path
                d="M22 19v21.2c0 8 5.7 13.1 14.1 13.1 8.3 0 13.9-5.1 13.9-13.1V19h-8.5v20.7c0 3.9-2 6.2-5.4 6.2s-5.5-2.3-5.5-6.2V19H22z"
                fill="#ffffff"
            />
            <circle
                cx="46"
                cy="16"
                r="5"
                fill="#75c2ad"
                stroke="#ffffff"
                strokeWidth="2"
            />
        </svg>
    );
}
