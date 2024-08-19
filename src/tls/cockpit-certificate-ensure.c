/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include <gnutls/gnutls.h>
#include <gnutls/x509.h>
#include <assert.h>
#include <err.h>
#include <errno.h>
#include <fcntl.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#include <common/cockpitwebcertificate.h>
#include <common/cockpitmemory.h>

#include "certificate.h"
#include "utils.h"

#define COCKPIT_CERTIFICATE_HELPER   LIBEXECDIR "/cockpit-certificate-helper"

// Cross-reference with cockpit-certificate-helper.in
#define COCKPIT_SELFSIGNED_FILENAME  "/cockpit/ws-certs.d/0-self-signed.cert"
#define COCKPIT_SELFSIGNED_PATH      PACKAGE_SYSCONF_DIR COCKPIT_SELFSIGNED_FILENAME

// Renew certificates with less than 30 days validity
#define EXPIRY_THRESHOLD (30 * 24 * 60 * 60)

// We used to issue 100 year certificates, but browsers no longer accept
// those.  Make sure we reissue those as well: anything with an expiry
// of more than ~5 years from now was surely generated by the old code.
#define MAX_EXPIRY (5 * 365 * 24 * 60 * 60)

// We tolerate the deprecated merged cert/key files only for cockpit-tls.
static bool tolerate_merged_cert_key;

typedef struct
{
  char *certificate_filename;
  gnutls_datum_t certificate;
  char *key_filename;
  gnutls_datum_t key;

  char *filename_for_errors;
} CertificateKeyPair;

static void
read_file (const char     *filename,
           gnutls_datum_t *result)
{
  int fd = open (filename, O_RDONLY);
  if (fd == -1)
    err (EXIT_FAILURE, "open: %s", filename);

  struct stat buf;
  if (fstat (fd, &buf) != 0)
    err (EXIT_FAILURE, "fstat: %s", filename);

  if (!S_ISREG (buf.st_mode))
    errx (EXIT_FAILURE, "%s: not a regular file", filename);

  result->size = buf.st_size;
  result->data = mallocx (result->size + 1);

  ssize_t s = read (fd, result->data, result->size);
  if (s == -1)
    err (EXIT_FAILURE, "read: %s", filename);
  if (s != result->size)
    errx (EXIT_FAILURE, "read: %s: got %zu bytes, expecting %zu",
          filename, s, (size_t) result->size);

  result->data[s] = '\0';

  close (fd);
}

static void
write_file (int                   dirfd,
            const char           *dirfd_filename,
            const char           *filename,
            const gnutls_datum_t *data,
            uid_t                 uid,
            gid_t                 gid)
{
  /* Just open the file directly: it doesn't exist yet and nobody will
   * look at it until after we're done here.
   */
  int fd = openat (dirfd, filename, O_CREAT | O_EXCL | O_WRONLY, 0400);

  if (fd == -1)
    err (EXIT_FAILURE, "%s/%s: creat", dirfd_filename, filename);

  size_t s = write (fd, data->data, data->size);
  if (s == -1)
    err (EXIT_FAILURE, "%s/%s: write", dirfd_filename, filename);
  if (s != data->size)
    errx (EXIT_FAILURE, "%s/%s: write: wrote %zu bytes, expecting %zu",
          dirfd_filename, filename, s, (size_t) data->size);

  /* This is actually making the file more accessible, to do it last */
  if (fchown (fd, uid, gid) != 0)
    err (EXIT_FAILURE, "%s/%s: fchown", dirfd_filename, filename);

  close (fd);
}

static bool
is_selfsigned (const char *certificate_filename)
{
  return strstr (certificate_filename, COCKPIT_SELFSIGNED_FILENAME) != NULL;
}

static bool
check_expiry (gnutls_certificate_credentials_t creds,
              const char                       *certificate_filename)
{
  gnutls_x509_crt_t *crt_list;
  unsigned int crt_list_size;

  int ret = gnutls_certificate_get_x509_crt (creds, 0, &crt_list, &crt_list_size);
  assert (ret == GNUTLS_E_SUCCESS);

  if (crt_list_size != 1)
    errx (EXIT_FAILURE, "unable to check expiry of chained certificates");

  time_t expires = gnutls_x509_crt_get_expiration_time (crt_list[0]);
  gnutls_x509_crt_deinit (crt_list[0]);
  gnutls_free (crt_list);

  debug (ENSURE, "Certificate %s expires %ld", certificate_filename, (long) expires);

  time_t now = time (NULL);
  if (expires > now + MAX_EXPIRY)
    {
      debug (ENSURE, "Certificate %s expires %ld, too far in the future",
             certificate_filename, (long) expires);

      return true;
    }

  time_t last_valid_expiry = now + EXPIRY_THRESHOLD;
  if (expires < last_valid_expiry)
    {
      debug (ENSURE, "Certificate %s expires %ld, which is before %ld",
             certificate_filename, (long) expires, (long) last_valid_expiry);

      return true;
    }

   debug (ENSURE, "Certificate %s expires %ld, which is after %ld",
          certificate_filename, (long) expires, (long) last_valid_expiry);

  return false;
}

static void
certificate_and_key_clear (CertificateKeyPair *self)
{
  /* gnutls_datum_free is side-effecting and sets ->data = NULL */
  free (self->certificate.data);
  self->certificate.data = NULL;
  self->certificate.size = 0;

  free (self->certificate_filename);
  self->certificate_filename = NULL;

  free (self->key.data);
  self->key.data = NULL;
  self->key.size = 0;

  free (self->key_filename);
  self->key_filename = NULL;

  free (self->filename_for_errors);
  self->filename_for_errors = NULL;
}

static void
certificate_and_key_write (const CertificateKeyPair *self,
                           const char               *directory)
{
  int dirfd = open (directory, O_PATH | O_DIRECTORY | O_NOFOLLOW);
  if (dirfd == -1)
    err (EXIT_FAILURE, "open: %s", directory);

  struct stat buf;
  if (fstat (dirfd, &buf) != 0)
    err (EXIT_FAILURE, "fstat: %s", directory);

  int r = mkdirat (dirfd, "server", 0700);
  if (r != 0)
    err (EXIT_FAILURE, "mkdir: %s/%s", directory, "server");

  /* fchown() won't accept file descriptors opened O_PATH */
  int fd = openat (dirfd, "server", O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (fd == -1)
    err (EXIT_FAILURE, "open: %s", directory);

  /* Copy the owner/group from the parent directory */
  if (fchown (fd, buf.st_uid, buf.st_gid) != 0)
    err (EXIT_FAILURE, "%s: fchown", directory);

  if (symlinkat (self->certificate_filename, fd, "cert.source") != 0)
    err (EXIT_FAILURE, "%s/%s: symlinkat", directory, "certificate.source");

  if (symlinkat (self->key_filename, fd, "key.source") != 0)
    err (EXIT_FAILURE, "%s/%s: symlinkat", directory, "key.source");

  write_file (fd, directory, "cert", &self->certificate, buf.st_uid, buf.st_gid);

  write_file (fd, directory, "key", &self->key, buf.st_uid, buf.st_gid);

  close (dirfd);
  close (fd);
}

static bool
certificate_and_key_split (CertificateKeyPair *self)
{
  const char *pairs[][2] = {
      { "-----BEGIN RSA PRIVATE KEY-----", "-----END RSA PRIVATE KEY-----" },
      /* this is slightly asymmetrical -- parameters and private key occur in the same file */
      { "-----BEGIN EC PARAMETERS-----",   "-----END EC PRIVATE KEY-----" },
      { "-----BEGIN PRIVATE KEY-----",     "-----END PRIVATE KEY-----" },
  };

  for (int i = 0; i < N_ELEMENTS (pairs); i++)
    {
      char *start = strstr ((const char *) self->certificate.data, pairs[i][0]);

      if (!start)
        continue;

      char *end = strstr ((const char *) self->certificate.data, pairs[i][1]);
      if (!end)
        errx (EXIT_FAILURE, "%s: found '%s' but not '%s'",
              self->certificate_filename, pairs[i][0], pairs[i][1]);

      /* Consume the footer and any extra newlines */
      end += strlen (pairs[i][1]);
      while (*end == '\r' || *end == '\n')
        end++;

      /* Cut out the private key */
      self->key.data = (unsigned char *) strndupx (start, end - start);
      self->key.size = end - start;

      /* Everything else before and after is the public key */
      memmove (start, end, strlen (end) + 1);
      self->certificate.size -= end - start;

      return true;
    }

  return false;
}

static void
certificate_and_key_read (CertificateKeyPair *self,
                          const char         *certificate_filename)
{
  self->certificate_filename = strdupx (certificate_filename);
  read_file (self->certificate_filename, &self->certificate);

  if (certificate_and_key_split (self))
    {
      self->key_filename = strdupx (self->certificate_filename);
      warnx ("%s: merged certificate and key files are %s. "
             "Please use a separate .cert and .key file.\n",
             certificate_filename,
             tolerate_merged_cert_key ? "deprecated" : "unsupported");

      if (!tolerate_merged_cert_key)
        exit (EXIT_FAILURE);
    }
  else
    {
      self->key_filename = cockpit_certificate_key_path (self->certificate_filename);
      read_file (self->key_filename, &self->key);
    }

  if (self->key_filename)
    asprintfx (&self->filename_for_errors, "%s/.key", self->certificate_filename);
  else
    self->filename_for_errors = strdupx (self->certificate_filename);
}

static gnutls_certificate_credentials_t
certificate_and_key_parse_to_creds (CertificateKeyPair *self)
{
  gnutls_certificate_credentials_t creds = NULL;

  int r = gnutls_certificate_allocate_credentials (&creds);
  assert (r == GNUTLS_E_SUCCESS);

  r = gnutls_certificate_set_x509_key_mem (creds,
                                           &self->certificate, &self->key,
                                           GNUTLS_X509_FMT_PEM);

  if (r != GNUTLS_E_SUCCESS)
    errx (EXIT_FAILURE, "%s: %s", self->filename_for_errors, gnutls_strerror (r));

  return creds;
}

static bool
cockpit_certificate_find (CertificateKeyPair *result,
                          bool                verbose)
{
  char *error = NULL;
  char *certificate_filename = cockpit_certificate_locate (true, &error);

  if (error != NULL)
    errx (EXIT_FAILURE, "%s", error);

  if (certificate_filename == NULL)
    {
      if (verbose)
        printf ("Unable to find any certificate file\n");

      return false;
    }

  certificate_and_key_read (result, certificate_filename);

  gnutls_certificate_credentials_t creds = certificate_and_key_parse_to_creds (result);

  bool expired = is_selfsigned (certificate_filename) && check_expiry (creds, certificate_filename);
  if (expired)
    {
      if (verbose)
        printf ("Found self-signed %s, but it needs to be reissued\n",
                result->filename_for_errors);

      certificate_and_key_clear (result);
    }

  gnutls_certificate_free_credentials (creds);
  free (certificate_filename);

  return !expired;
}

static void
cockpit_certificate_selfsign (CertificateKeyPair *result)
{
  pid_t pid;
  int r = posix_spawn (&pid, COCKPIT_CERTIFICATE_HELPER, NULL, NULL,
                       (char *[]){ COCKPIT_CERTIFICATE_HELPER, "selfsign", NULL },
                       NULL);

  if (r != 0)
    errx (EXIT_FAILURE, "posix_spawn: %s: %s",
          COCKPIT_CERTIFICATE_HELPER, strerror (r));

  int status;
  do
    r = waitpid (pid, &status, 0);
  while (r == -1 && errno == EINTR);

  if (r < 0)
    err (EXIT_FAILURE, "wait: %s", COCKPIT_CERTIFICATE_HELPER);

  if (!WIFEXITED (status) || WEXITSTATUS (status) != 0)
    errx (EXIT_FAILURE, "%s exited with non-zero status %d",
          COCKPIT_CERTIFICATE_HELPER, WEXITSTATUS (status));

  certificate_and_key_read (result, COCKPIT_SELFSIGNED_PATH);

  /* We just generated this ourselves, so we don't bother to check it
   * for validity.
   */
}

int
main (int argc, char **argv)
{
  CertificateKeyPair result = { };
  bool check = false;
  bool for_cockpit_tls = false;

  if (argc == 1)
    ;
  else if (argc == 2 && strcmp (argv[1], "--check") == 0)
    check = true;
  else if (argc == 2 && strcmp (argv[1], "--for-cockpit-tls") == 0)
    for_cockpit_tls = true;
  else
    errx (EXIT_FAILURE, "usage: %s [--check]", argv[0]);

  if (for_cockpit_tls)
    tolerate_merged_cert_key = true;

  if (!cockpit_certificate_find (&result, check))
    {
      if (check)
        {
          printf ("Would create a self-signed certificate\n");
          return 1;
        }

      cockpit_certificate_selfsign (&result);
    }

  if (check)
    printf ("Would use certificate %s\n", result.certificate_filename);

  if (for_cockpit_tls)
    {
      const char *runtime_directory = getenv ("RUNTIME_DIRECTORY");
      if (runtime_directory == NULL)
        errx (EXIT_FAILURE, "--for-cockpit-tls cannot be used unless RUNTIME_DIRECTORY is set");

      certificate_and_key_write (&result, runtime_directory);
    }

  certificate_and_key_clear (&result);

  return 0;
}
