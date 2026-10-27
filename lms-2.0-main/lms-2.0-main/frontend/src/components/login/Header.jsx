import { asset } from '../../api/paths';

export default function Header() {
  return (
    <div className="absolute top-[38px] left-[70px] hidden lg:flex items-center gap-4 z-10">
      <img src={asset('brand/tektalis.svg')} alt="Tektalis" style={{ height: 26 }} />
      <div className="w-px h-6 bg-border" />
      <p className="small muted leading-none">Leave Management System</p>
    </div>
  );
}
