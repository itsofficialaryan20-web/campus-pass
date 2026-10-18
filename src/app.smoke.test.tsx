// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from './App';
import { api } from './lib/api';

const go = (path: string) => window.history.pushState({}, '', path);
async function loginAs(label: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(label) }));
}

beforeEach(async () => { api.demo!.reset(); await api.signOut(); localStorage.clear(); go('/'); });
afterEach(() => cleanup());

describe('app smoke test (demo mode)', () => {
  it('shows the login page with the demo-mode warning and no role picker', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getAllByText(/not production-secure/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/choose.*role/i)).toBeNull();
  });
  it('rejects a wrong password', async () => {
    render(<App />);
    fireEvent.change(await screen.findByLabelText(/college id or email/i), { target: { value: 'riya@demo.campus' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/incorrect/i)).toBeTruthy();
  });
  it('student: dashboard, progress, and new-request validation', async () => {
    render(<App />); await loginAs('Riya Sharma');
    expect(await screen.findByText(/Good (morning|afternoon|evening), Riya/)).toBeTruthy();
    expect(screen.getByText('Current request')).toBeTruthy();
    expect(screen.queryByText(/Return recorded/)).toBeNull();           // no return step any more
    fireEvent.click(screen.getAllByRole('link', { name: /new (exit )?request/i })[0]!);
    expect(await screen.findByRole('heading', { name: 'New exit request' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason for leaving campus'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText(/at least 3 characters/)).toBeTruthy();
  });
  it('student: submitting creates a request and shows its timeline', async () => {
    render(<App />); await loginAs('Arjun Nair'); await screen.findByText(/Good (morning|afternoon|evening), Arjun/);
    go('/requests/new'); window.dispatchEvent(new PopStateEvent('popstate'));
    fireEvent.change(await screen.findByLabelText('Reason for leaving campus'), { target: { value: 'Dentist appointment' } });
    fireEvent.change(screen.getByLabelText('Destination'), { target: { value: 'Smile Dental' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText('Approval timeline')).toBeTruthy();
    expect(screen.getByText(/Program Manager review in progress/)).toBeTruthy();
  });
  it('student past the return time is offered a re-entry request', async () => {
    render(<App />); await loginAs('Kiran Patel');
    expect(await screen.findByText(/past your expected return time/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: /request re-entry approval/i }));
    expect(await screen.findByRole('heading', { name: /request re-entry approval/i })).toBeTruthy();
    expect(screen.getByLabelText('Why will you be late?')).toBeTruthy();
  });
  it('program manager: queue, details, and decision buttons', async () => {
    render(<App />); await loginAs('Dr. Anita Rao');
    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeTruthy();
    fireEvent.click(await screen.findByText('Meera Iyer'));
    const approve = await screen.findByRole('button', { name: 'Approve' });
    fireEvent.click(approve);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('security gate: no return button, manual pass entry works', async () => {
    render(<App />); await loginAs('Gate Security');
    expect(await screen.findByRole('heading', { name: 'Gate verification' })).toBeTruthy();
    expect(screen.queryByText(/record return/i)).toBeNull();
    expect(screen.getByText(/No return scan/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /enter pass id/i }));
    fireEvent.change(screen.getByLabelText('Pass ID'), { target: { value: 'NOPE-NOPE1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('INVALID')).toBeTruthy();
  });
  it('admin: overview, users, reports and policies all render', async () => {
    render(<App />); await loginAs('Admin Office');
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy();
    expect(screen.getByText(/Needs attention/)).toBeTruthy();
    for (const [name, text] of [['Users & roles', 'Users & roles'], ['Reports & audit', 'Reports & audit'], ['Policies & settings', 'Policies & settings']] as const) {
      fireEvent.click(screen.getAllByRole('link', { name })[0]!);
      expect(await screen.findByRole('heading', { name: text })).toBeTruthy();
    }
  });
  it('a student cannot open admin pages', async () => {
    render(<App />); await loginAs('Riya Sharma'); await screen.findByText(/Good (morning|afternoon|evening)/);
    go('/admin/users'); window.dispatchEvent(new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', { name: 'Access denied' })).toBeTruthy();
  });
});

describe('absence cover (UI)', () => {
  it('a Program Manager can declare an absence from the Absence cover page', async () => {
    render(<App />); await loginAs('Dr. Anita Rao'); await screen.findByRole('heading', { name: 'Approvals' });
    fireEvent.click(screen.getAllByRole('link', { name: 'Absence cover' })[0]!);
    expect(await screen.findByRole('heading', { name: 'Absence cover' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Conference' } });
    fireEvent.click(screen.getByRole('button', { name: 'Declare absence' }));
    expect(await screen.findByText(/You are marked absent until/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End now' })).toBeTruthy();
  });
  it('with the SWO absent, the Program Manager queue shows a cover banner and a Cover badge', async () => {
    await api.signIn('swo@demo.campus', 'demo1234');
    await api.declareAbsence({ user_id: 'u-swo', ends_at: new Date(Date.now() + 86400000).toISOString(), reason: 'Out of station' });
    await api.signOut();
    render(<App />); await loginAs('Dr. Anita Rao');
    expect(await screen.findByText(/Absence cover is active/)).toBeTruthy();
    expect(screen.getAllByText('Cover').length).toBeGreaterThan(0);
    fireEvent.click(await screen.findByText('Riya Sharma'));
    expect(await screen.findByRole('button', { name: /Approve as cover for SWO/ })).toBeTruthy();
  });
});
